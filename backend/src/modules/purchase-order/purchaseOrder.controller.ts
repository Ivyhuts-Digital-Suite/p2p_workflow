import { FilterQuery, Types } from 'mongoose';
import { ROLES } from '../../constants/roles';
import {
  APPROVAL_STATUS,
  BID_STATUS,
  INVOICE_STATUS,
  ITEM_TYPE,
  PO_INVOICEABLE_STATUSES,
  PO_PAST_STATUSES,
  PO_STATUS,
  PO_VENDOR_INVOICEABLE_STATUSES,
  PR_STATUS,
} from '../../constants/status';
import { currentUser } from '../../middleware/auth';
import { Bid } from '../../models/Bid';
import { IInvoice, Invoice } from '../../models/Invoice';
import { IPurchaseOrder, PurchaseOrder, PurchaseOrderDocument } from '../../models/PurchaseOrder';
import { PurchaseRequisition } from '../../models/PurchaseRequisition';
import { RFQ } from '../../models/RFQ';
import { adjustCommitment } from '../../services/budget.service';
import { assertCanApprove } from '../../services/doa.service';
import { clearedQuantities } from '../../services/matching.service';
import { createPoFromBid, issueIfFullyApproved, preparePoFromBid, vendorPoScope } from '../../services/purchaseOrder.service';
import { loadDirectory, poPendingAt } from '../../services/workflow.service';
import { AuthUser } from '../../types/auth';
import { ApiError } from '../../utils/ApiError';
import { asyncHandler } from '../../utils/asyncHandler';
import { round2 } from '../../utils/money';
import { oid } from '../../utils/objectId';

const BILLED_INVOICE_STATUSES: string[] = [INVOICE_STATUS.BOOKED, INVOICE_STATUS.TAX_VERIFIED, INVOICE_STATUS.PAID];
/** POs whose goods the Store can still receive */
const RECEIVABLE_STATUSES: string[] = [PO_STATUS.ISSUED, PO_STATUS.ACKNOWLEDGED, PO_STATUS.PARTIALLY_RECEIVED];

type InvoiceLines = Pick<
  IInvoice,
  'purchaseOrder' | 'invoiceNumber' | 'internalRef' | 'invoiceDate' | 'items' | 'status' | 'subtotal' | 'gstAmount' | 'total' | 'boxesOnPaperwork'
> & { _id: Types.ObjectId };

/** Each PO's invoices that are still live (not rejected), oldest first. */
async function liveInvoicesByPo(pos: PurchaseOrderDocument[]): Promise<Map<string, InvoiceLines[]>> {
  const invoices = await Invoice.find({ purchaseOrder: { $in: pos.map((po) => po._id) }, status: { $ne: INVOICE_STATUS.REJECTED } })
    .select('purchaseOrder invoiceNumber internalRef invoiceDate items status subtotal gstAmount total boxesOnPaperwork')
    .sort({ createdAt: 1 })
    .lean<InvoiceLines[]>();
  const byPo = new Map<string, InvoiceLines[]>();
  for (const invoice of invoices) {
    const key = invoice.purchaseOrder.toString();
    byPo.set(key, [...(byPo.get(key) ?? []), invoice]);
  }
  return byPo;
}

/** Per PO line, what the vendor can still invoice: ordered, less what their live invoices already bill. */
function openToInvoice(po: PurchaseOrderDocument, invoices: InvoiceLines[]): Map<string, number> {
  const billed = new Map<string, number>();
  for (const invoice of invoices) {
    for (const line of invoice.items) billed.set(line.poItem.toString(), (billed.get(line.poItem.toString()) ?? 0) + line.quantity);
  }
  return new Map(po.items.map((i) => [i._id.toString(), Math.max(round2(i.quantity - (billed.get(i._id.toString()) ?? 0)), 0)]));
}

/**
 * The vendor invoice the Store receives this PO's goods against: the oldest live invoice on the PO with goods
 * still to arrive, and those quantities. What has been accepted so far is counted against invoices oldest first.
 */
function invoiceToReceive(po: PurchaseOrderDocument, invoices: InvoiceLines[]) {
  if (!RECEIVABLE_STATUSES.includes(po.status)) return undefined;
  const goods = new Map(po.items.filter((i) => i.itemType !== ITEM_TYPE.SERVICE).map((i) => [i._id.toString(), i]));
  const accepted = new Map([...goods.values()].map((i) => [i._id.toString(), i.receivedQty]));
  for (const invoice of invoices) {
    const toReceive: { poItem: Types.ObjectId; quantity: number }[] = [];
    for (const line of invoice.items) {
      const key = line.poItem.toString();
      const poItem = goods.get(key);
      if (!poItem) continue;
      const covered = Math.min(line.quantity, accepted.get(key) ?? 0);
      accepted.set(key, round2((accepted.get(key) ?? 0) - covered));
      // Never more than the PO still expects on that line.
      const quantity = Math.min(round2(line.quantity - covered), round2(poItem.quantity - poItem.receivedQty));
      if (quantity > 0) toReceive.push({ poItem: line.poItem, quantity });
    }
    if (toReceive.length) {
      return {
        invoiceId: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        internalRef: invoice.internalRef,
        invoiceDate: invoice.invoiceDate,
        boxesOnPaperwork: invoice.boxesOnPaperwork ?? 0,
        items: toReceive,
      };
    }
  }
  return undefined;
}

/** A submitted vendor invoice as the Store sees it from the PO: the bill, read only. */
function invoiceView(invoice: InvoiceLines) {
  return {
    _id: invoice._id,
    internalRef: invoice.internalRef,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    status: invoice.status,
    boxesOnPaperwork: invoice.boxesOnPaperwork ?? 0,
    items: invoice.items.map((l) => ({ poItem: l.poItem, title: l.title, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate, lineTotal: l.lineTotal })),
    subtotal: invoice.subtotal,
    gstAmount: invoice.gstAmount,
    total: invoice.total,
  };
}

/** The invoice and receipt state of one PO, for its row: what can be invoiced, and what the Store receives against. */
function invoiceFlow(po: PurchaseOrderDocument, invoices: InvoiceLines[]) {
  const open = openToInvoice(po, invoices);
  return {
    openToInvoice: open,
    canInvoice: PO_VENDOR_INVOICEABLE_STATUSES.includes(po.status) && [...open.values()].some((q) => q > 0),
    invoiceToReceive: invoiceToReceive(po, invoices),
  };
}

function visibilityScope(user: AuthUser): FilterQuery<IPurchaseOrder> {
  switch (user.role) {
    case ROLES.VENDOR:
      return vendorPoScope(user.vendor);
    case ROLES.HOD:
    case ROLES.REQUESTER:
      return { department: user.department };
    default:
      return {};
  }
}

async function loadPo(id: string, user: AuthUser): Promise<PurchaseOrderDocument> {
  const po = await PurchaseOrder.findOne({ $and: [{ _id: id }, visibilityScope(user)] });
  if (!po) throw ApiError.notFound('Purchase order');
  return po;
}

function assertStatus(po: PurchaseOrderDocument, allowed: string[]) {
  if (!allowed.includes(po.status)) throw ApiError.unprocessable(`Action not allowed while PO is ${po.status}`);
}

/** A vendor never sees how their price compares with the buyer's estimate or budget. */
function vendorSafe<T extends Partial<IPurchaseOrder>>(po: T, user: AuthUser): T {
  if (user.role !== ROLES.VENDOR) return po;
  const { budgetVariance: _variance, doaRule: _rule, createdBy: _createdBy, shortClose, ...view } = po;
  return { ...view, ...(shortClose?.at && { shortClose: { reason: shortClose.reason, at: shortClose.at } }) } as T;
}

// ---------------------------------------------------------------------------------

/**
 * Creates the PO for an awarded bid. Awarding an RFQ does this automatically, so this is the
 * retry for an award whose PO could not be stored (or one awarded before that was the case).
 */
export const createFromBid = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const bid = await Bid.findById(req.params.bidId);
  if (!bid) throw ApiError.notFound('Bid');
  if (bid.status !== BID_STATUS.AWARDED) throw ApiError.unprocessable('Only an awarded bid can be converted to a PO');
  if (await PurchaseOrder.exists({ bid: bid._id, status: { $ne: PO_STATUS.CANCELLED } })) {
    throw ApiError.conflict('A PO already exists for this bid');
  }

  const rfq = await RFQ.findById(bid.rfq);
  if (!rfq) throw ApiError.notFound('RFQ');

  const prepared = await preparePoFromBid(bid, rfq, req.body);
  res.status(201).json(await createPoFromBid(bid, rfq, user, prepared));
});

/** True when the PO's next approval step is the caller's. Later steps wait for earlier ones. */
function isNextApprover(po: PurchaseOrderDocument, user: AuthUser) {
  const next = po.approvals.find((a) => a.status === APPROVAL_STATUS.PENDING);
  return po.status === PO_STATUS.PENDING_APPROVAL && !!next && (user.role === ROLES.ADMIN || next.role === user.role);
}

/** Maps the view tabs to a status filter: active work, or finished history. */
function viewFilter(view: unknown): FilterQuery<IPurchaseOrder> {
  if (view === 'past') return { status: { $in: PO_PAST_STATUSES } };
  if (view === 'active') return { status: { $nin: PO_PAST_STATUSES } };
  return {};
}

export const listPurchaseOrders = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const conditions: FilterQuery<IPurchaseOrder>[] = [visibilityScope(user), viewFilter(req.query.view)];
  if (req.query.status) conditions.push({ status: String(req.query.status) });

  let pos = await PurchaseOrder.find({ $and: conditions })
    .populate('vendor', 'companyName vendorCode contactPerson')
    .populate('department', 'name code')
    // The RFQ title is the PO's title (vendors already see RFQ titles).
    .populate('rfq', 'rfqNumber title')
    .sort({ createdAt: -1 });
  if (req.query.pendingMyApproval === 'true') pos = pos.filter((po) => isNextApprover(po, user));

  // What has been billed and paid, so that a past PO can be audited from this list.
  const billing = await Invoice.aggregate<{ _id: Types.ObjectId; invoiced: number; paid: number }>([
    { $match: { purchaseOrder: { $in: pos.map((po) => po._id) }, status: { $in: BILLED_INVOICE_STATUSES } } },
    {
      $group: {
        _id: '$purchaseOrder',
        invoiced: { $sum: '$total' },
        paid: { $sum: { $cond: [{ $eq: ['$status', INVOICE_STATUS.PAID] }, '$total', 0] } },
      },
    },
  ]);
  const billingByPo = new Map(billing.map((b) => [b._id.toString(), b]));
  const directory = await loadDirectory(user);
  const invoicesOf = await liveInvoicesByPo(pos);
  res.json(
    pos.map((po) => {
      const billed = billingByPo.get(po._id.toString());
      const department = po.department as unknown as { _id: Types.ObjectId } | undefined;
      const view = po.toObject();
      // Bound to this PO alone: its own lines, and its own vendor invoice for the Store.
      const flow = invoiceFlow(po, invoicesOf.get(po._id.toString()) ?? []);
      return vendorSafe(
        {
          ...view,
          items: view.items.map((i) => ({ ...i, openToInvoiceQty: flow.openToInvoice.get(i._id.toString()) ?? 0 })),
          canInvoice: flow.canInvoice,
          invoiceToReceive: flow.invoiceToReceive,
          // The Store reads this PO's own submitted invoices here, without the Invoices tab.
          ...(user.role === ROLES.STORE && { invoices: (invoicesOf.get(po._id.toString()) ?? []).map(invoiceView) }),
          invoicedAmount: billed?.invoiced ?? 0,
          paidAmount: billed?.paid ?? 0,
          pendingAt: poPendingAt({ ...po.toObject(), department: department?._id } as IPurchaseOrder, directory),
        },
        user,
      );
    }),
  );
});

/** Counts for the dashboard and the view tabs, within what the caller may see. */
export const purchaseOrderSummary = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const pos = await PurchaseOrder.find(visibilityScope(user)).select('status approvals');
  const past = pos.filter((po) => PO_PAST_STATUSES.includes(po.status)).length;
  res.json({
    active: pos.length - past,
    past,
    pendingMyApproval: pos.filter((po) => isNextApprover(po, user)).length,
  });
});

/**
 * The POs the caller can invoice, from the live database. A vendor gets only their own POs,
 * and only once accepted. Fully billed POs are left out: nothing remains to invoice on them.
 * Each line says how much the Store or a sign-off has cleared for billing.
 */
export const listInvoiceablePurchaseOrders = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const statuses = user.role === ROLES.VENDOR ? PO_VENDOR_INVOICEABLE_STATUSES : PO_INVOICEABLE_STATUSES;
  const found = await PurchaseOrder.find({ $and: [visibilityScope(user), { status: { $in: statuses } }] })
    .populate('vendor', 'companyName vendorCode contactPerson')
    .sort({ createdAt: -1 });
  const invoicesOf = await liveInvoicesByPo(found);
  const pos = found.filter((po) => [...openToInvoice(po, invoicesOf.get(po._id.toString()) ?? []).values()].some((q) => q > 0));
  const cleared = await clearedQuantities(pos);
  res.json(
    pos.map((po) => {
      const view = po.toObject();
      const open = openToInvoice(po, invoicesOf.get(po._id.toString()) ?? []);
      return vendorSafe(
        {
          ...view,
          items: view.items.map((i) => ({ ...i, clearedQty: cleared.get(i._id.toString()) ?? 0, openToInvoiceQty: open.get(i._id.toString()) ?? 0 })),
        },
        user,
      );
    }),
  );
});

export const getPurchaseOrder = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const po = await loadPo(req.params.id, user);
  await po.populate([
    { path: 'vendor', select: 'companyName vendorCode gstin email contactPerson' },
    { path: 'department', select: 'name code' },
    { path: 'approvals.actedBy', select: 'name role' },
    { path: 'requisitions', select: 'prNumber title' },
  ]);
  res.json(vendorSafe(po.toObject(), user));
});

export const approvePurchaseOrder = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const po = await loadPo(req.params.id, user);
  assertStatus(po, [PO_STATUS.PENDING_APPROVAL]);

  const step = assertCanApprove(po, user);
  step.status = APPROVAL_STATUS.APPROVED;
  step.actedBy = oid(user.id);
  step.actedAt = new Date();
  step.remarks = req.body.remarks;

  // The final approval issues the PO to the vendor: there is no separate issue step.
  issueIfFullyApproved(po);
  await po.save();
  res.json(po);
});

export const rejectPurchaseOrder = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const po = await loadPo(req.params.id, user);
  assertStatus(po, [PO_STATUS.PENDING_APPROVAL]);

  const step = assertCanApprove(po, { ...user, doaLimit: Number.MAX_SAFE_INTEGER }); // rejecting needs no limit
  step.status = APPROVAL_STATUS.REJECTED;
  step.actedBy = oid(user.id);
  step.actedAt = new Date();
  step.remarks = req.body.remarks;
  po.status = PO_STATUS.REJECTED;
  await po.save();
  res.json(po);
});

/** Releases a PO approved before approval issued it automatically. Kept for those older POs only. */
export const issuePurchaseOrder = asyncHandler(async (req, res) => {
  const po = await loadPo(req.params.id, currentUser(req));
  assertStatus(po, [PO_STATUS.APPROVED]);
  po.status = PO_STATUS.ISSUED;
  po.issuedAt = new Date();
  await po.save();
  res.json(po);
});

/** Cancels a PO with no receipts and returns its PRs to the approved pool for re-sourcing. */
export const cancelPurchaseOrder = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const po = await loadPo(req.params.id, user);
  assertStatus(po, [PO_STATUS.PENDING_APPROVAL, PO_STATUS.APPROVED, PO_STATUS.REJECTED, PO_STATUS.ISSUED, PO_STATUS.ACKNOWLEDGED]);
  if (po.items.some((i) => i.receivedQty > 0)) {
    throw ApiError.unprocessable('Goods have already been received against this PO');
  }

  po.status = PO_STATUS.CANCELLED;
  await po.save();
  // The PRs go back to committing their estimates, so undo the change the award made.
  await adjustCommitment(po.department, -(po.budgetVariance ?? 0));
  await PurchaseRequisition.updateMany(
    { _id: { $in: po.requisitions } },
    {
      $set: { status: PR_STATUS.APPROVED },
      $unset: { rfq: 1, purchaseOrder: 1 },
      $push: { history: { action: 'PO_CANCELLED', by: oid(user.id), at: new Date(), remarks: req.body.reason } },
    },
  );
  res.json(po);
});
