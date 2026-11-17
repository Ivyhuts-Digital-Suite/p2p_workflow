import mongoose, { FilterQuery } from 'mongoose';
import { ROLES } from '../constants/roles';
import { APPROVAL_STATUS, PO_STATUS, PR_STATUS } from '../constants/status';
import { BidDocument } from '../models/Bid';
import { IPoApproval, IPurchaseOrder, PurchaseOrder, PurchaseOrderDocument } from '../models/PurchaseOrder';
import { PurchaseRequisition } from '../models/PurchaseRequisition';
import { RFQ, RfqDocument } from '../models/RFQ';
import { AuthUser } from '../types/auth';
import { ApiError } from '../utils/ApiError';
import { calcOrderTotals } from '../utils/money';
import { oid } from '../utils/objectId';
import { nextDocNumber } from '../utils/sequence';
import { resolveApprovalChain } from './doa.service';
import { activeRole } from './workflow.service';

const VENDOR_VISIBLE: string[] = [
  PO_STATUS.ISSUED,
  PO_STATUS.ACKNOWLEDGED,
  PO_STATUS.PARTIALLY_RECEIVED,
  PO_STATUS.RECEIVED,
  PO_STATUS.CLOSED,
  PO_STATUS.SHORT_CLOSED,
];

/** A vendor's own POs once issued. One cancelled after that stays in their history; one never issued was never theirs to see. */
export function vendorPoScope(vendor: AuthUser['vendor']): FilterQuery<IPurchaseOrder> {
  return {
    vendor,
    $or: [{ status: { $in: VENDOR_VISIBLE } }, { status: PO_STATUS.CANCELLED, issuedAt: { $exists: true } }],
  };
}

/** Sets the receipt stage from the received quantities. */
export function refreshReceiptStatus(po: PurchaseOrderDocument) {
  if (po.items.every((i) => i.receivedQty >= i.quantity)) po.status = PO_STATUS.RECEIVED;
  else if (po.items.some((i) => i.receivedQty > 0)) po.status = PO_STATUS.PARTIALLY_RECEIVED;
  else po.status = po.acknowledgedAt ? PO_STATUS.ACKNOWLEDGED : PO_STATUS.ISSUED;
}

/** Applies a change to a PO, re-reading and retrying if someone else saved it in between. */
export async function updatePurchaseOrder(id: unknown, change: (po: PurchaseOrderDocument) => void): Promise<PurchaseOrderDocument> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const po = await PurchaseOrder.findById(id);
    if (!po) throw ApiError.notFound('Purchase order');
    change(po);
    try {
      return await po.save();
    } catch (err) {
      if (!(err instanceof mongoose.Error.VersionError)) throw err;
    }
  }
  throw ApiError.conflict('The purchase order is being changed by someone else - please retry');
}

export interface PoTerms {
  /** Overrides the GST the vendor quoted, on every line */
  taxRate?: number;
  lineTaxRates?: Record<string, number>;
  deliveryAddress?: string;
  expectedDeliveryDate?: Date;
  paymentTerms?: string;
}

/**
 * Works out the PO for an awarded bid and checks it can be created, changing nothing.
 * Running this before an award means a missing DoA rule refuses the award instead of stranding it.
 */
export async function preparePoFromBid(bid: BidDocument, rfq: RfqDocument, terms: PoTerms) {
  // After a PO cancellation the PRs return to the approved pool and must be re-sourced.
  const sourcedPrs = await PurchaseRequisition.countDocuments({
    _id: { $in: rfq.requisitions },
    status: PR_STATUS.SOURCING,
    rfq: rfq._id,
  });
  if (sourcedPrs !== rfq.requisitions.length) {
    throw ApiError.unprocessable("This RFQ's requisitions are no longer under sourcing; run a new RFQ");
  }

  const { taxRate, lineTaxRates = {}, ...rest } = terms;
  const items = bid.items.map((line) => {
    const rfqItem = rfq.items.find((i) => i._id.equals(line.rfqItem));
    if (!rfqItem) throw ApiError.unprocessable('Bid references an unknown RFQ line');
    return {
      rfqItem: rfqItem._id,
      itemCode: rfqItem.itemCode,
      title: rfqItem.title,
      description: rfqItem.description,
      quantity: line.quantity,
      uom: rfqItem.uom,
      unitPrice: line.unitPrice,
      taxRate: lineTaxRates[rfqItem._id.toString()] ?? taxRate ?? line.taxRate,
      itemType: rfqItem.itemType,
    };
  });

  const { rule, approvals } = await resolveApprovalChain(calcOrderTotals(items).grandTotal);
  return { items, rule, approvals, rest };
}

export const AUTO_APPROVAL_REMARK = 'Auto-approved at vendor selection, within Procurement authority';

/**
 * Selecting the vendor is the Procurement decision, so the PO's Procurement level is taken at once by
 * the user who selected it, instead of waiting for a second Procurement user. That holds only when the
 * Procurement level comes first and, if it is also the last level, the user's own DoA limit covers the PO.
 * Any HOD or Finance level stays pending for that authority.
 */
function autoApproveProcurementLevel(approvals: IPoApproval[], user: AuthUser, grandTotal: number): IPoApproval[] {
  const [first] = approvals;
  if (!first || first.status !== APPROVAL_STATUS.PENDING || activeRole(first.role) !== ROLES.PROCUREMENT) return approvals;
  if (user.role !== ROLES.PROCUREMENT && user.role !== ROLES.ADMIN) return approvals;
  if (approvals.length === 1 && user.doaLimit < grandTotal) return approvals;
  return [
    { ...first, status: APPROVAL_STATUS.APPROVED, actedBy: oid(user.id), actedAt: new Date(), remarks: AUTO_APPROVAL_REMARK },
    ...approvals.slice(1),
  ];
}

/** A PO with every approval level taken goes to the vendor straight away: there is no separate issue step. */
export function issueIfFullyApproved(po: PurchaseOrderDocument) {
  if (po.status === PO_STATUS.PENDING_APPROVAL && po.approvals.every((a) => a.status === APPROVAL_STATUS.APPROVED)) {
    po.status = PO_STATUS.ISSUED;
    po.issuedAt = new Date();
  }
}

/**
 * Stores the PO, attaches its DoA chain, and links it to the RFQ and its requisitions. Within the selecting
 * user's authority it is approved and issued at once; otherwise it waits for the remaining approval levels.
 */
export async function createPoFromBid(
  bid: BidDocument,
  rfq: RfqDocument,
  user: AuthUser,
  prepared: Awaited<ReturnType<typeof preparePoFromBid>>,
): Promise<PurchaseOrderDocument> {
  const userId = user.id;
  const grandTotal = calcOrderTotals(prepared.items).grandTotal;
  const approvals = autoApproveProcurementLevel(prepared.approvals, user, grandTotal);
  const fullyApproved = approvals.every((a) => a.status === APPROVAL_STATUS.APPROVED);
  const po = await PurchaseOrder.create({
    ...prepared.rest,
    poNumber: await nextDocNumber('PO'),
    rfq: rfq._id,
    bid: bid._id,
    vendor: bid.vendor,
    department: rfq.department,
    requisitions: rfq.requisitions,
    items: prepared.items,
    doaRule: prepared.rule._id,
    approvals,
    createdBy: userId,
    isEmergency: rfq.isEmergency,
    budgetVariance: rfq.budgetVariance,
    // An emergency PO skips approval and is issued at once. Finance ratifies it afterwards, before it can be paid.
    ...((rfq.isEmergency || fullyApproved) && { status: PO_STATUS.ISSUED, issuedAt: new Date() }),
  });

  await Promise.all([
    RFQ.updateOne({ _id: rfq._id }, { purchaseOrder: po._id }),
    PurchaseRequisition.updateMany(
      { _id: { $in: rfq.requisitions } },
      {
        $set: { status: PR_STATUS.PO_CREATED, purchaseOrder: po._id },
        $push: { history: { action: 'PO_CREATED', by: oid(userId), at: new Date(), remarks: po.poNumber } },
      },
    ),
  ]);
  return po;
}
