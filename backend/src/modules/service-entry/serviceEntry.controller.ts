import { Request } from 'express';
import { FilterQuery } from 'mongoose';
import { ROLES } from '../../constants/roles';
import { ITEM_TYPE, NEEDS_COMMISSIONING, PO_STATUS, SERVICE_ENTRY_STATUS } from '../../constants/status';
import { currentUser } from '../../middleware/auth';
import { PurchaseOrder } from '../../models/PurchaseOrder';
import { IServiceEntry, ServiceEntry } from '../../models/ServiceEntry';
import { rematchOpenInvoices } from '../../services/matching.service';
import { refreshReceiptStatus, updatePurchaseOrder } from '../../services/purchaseOrder.service';
import { AuthUser } from '../../types/auth';
import { ApiError } from '../../utils/ApiError';
import { asyncHandler } from '../../utils/asyncHandler';
import { round2 } from '../../utils/money';
import { oid } from '../../utils/objectId';
import { nextDocNumber } from '../../utils/sequence';

const SIGNABLE: string[] = [PO_STATUS.ISSUED, PO_STATUS.ACKNOWLEDGED, PO_STATUS.PARTIALLY_RECEIVED, PO_STATUS.RECEIVED];

function scope(user: AuthUser): FilterQuery<IServiceEntry> {
  if (user.role === ROLES.VENDOR) return { vendor: user.vendor };
  if (user.role === ROLES.HOD || user.role === ROLES.REQUESTER) return { department: user.department };
  return {};
}

export const listServiceEntries = asyncHandler(async (req, res) => {
  const entries = await ServiceEntry.find(scope(currentUser(req)))
    .populate('purchaseOrder', 'poNumber')
    .populate('vendor', 'companyName contactPerson')
    .populate('raisedBy', 'name')
    .populate('decidedBy', 'name')
    .sort({ createdAt: -1 });
  res.json(entries);
});

/** Records that a service was performed, or that a unit of equipment was installed and works. The department's HOD then accepts it. */
export const createServiceEntry = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const { purchaseOrderId, poItemId, quantity, completedOn, remarks } = req.body;

  const po = await PurchaseOrder.findById(purchaseOrderId);
  const ownDepartmentOnly = user.role === ROLES.HOD || user.role === ROLES.REQUESTER;
  if (!po || (ownDepartmentOnly && po.department.toString() !== user.department)) throw ApiError.notFound('Purchase order');
  if (!SIGNABLE.includes(po.status)) throw ApiError.unprocessable(`Nothing can be signed off on a PO that is ${po.status}`);

  const line = po.items.find((i) => i._id.equals(poItemId));
  if (!line) throw ApiError.notFound('PO line');
  if (line.itemType !== ITEM_TYPE.SERVICE && !NEEDS_COMMISSIONING.includes(line.itemType)) {
    throw ApiError.unprocessable(`${line.description} is received at the store, not signed off`);
  }

  // Quantities awaiting a decision count against the limit, so the same work cannot be signed off twice.
  const pending = await ServiceEntry.find({ purchaseOrder: po._id, poItem: line._id, status: SERVICE_ENTRY_STATUS.PENDING }).select('quantity');
  const pendingQty = pending.reduce((sum, e) => sum + e.quantity, 0);
  const isService = line.itemType === ITEM_TYPE.SERVICE;
  const open = isService ? line.quantity - line.receivedQty - pendingQty : line.receivedQty - line.commissionedQty - pendingQty;
  if (quantity > round2(open)) {
    throw ApiError.unprocessable(
      isService
        ? `${line.description}: only ${round2(open)} is left to sign off`
        : `${line.description}: only ${round2(open)} delivered unit(s) await commissioning`,
    );
  }

  const entry = await ServiceEntry.create({
    entryNumber: await nextDocNumber('SES'),
    type: isService ? 'SERVICE' : 'COMMISSIONING',
    purchaseOrder: po._id,
    poItem: line._id,
    vendor: po.vendor,
    department: po.department,
    description: line.description,
    quantity,
    completedOn,
    remarks,
    raisedBy: user.id,
  });
  res.status(201).json(entry);
});

async function claimDecision(req: Request, user: AuthUser, status: string) {
  const entry = await ServiceEntry.findById(req.params.id);
  if (!entry) throw ApiError.notFound('Service entry');
  if (user.role !== ROLES.ADMIN && entry.department.toString() !== user.department) {
    throw ApiError.forbidden('Only the HOD of the ordering department can decide this sign-off');
  }
  if (entry.raisedBy.toString() === user.id) {
    throw ApiError.forbidden('Segregation of duties: whoever raised a sign-off cannot accept it');
  }
  const decided = await ServiceEntry.findOneAndUpdate(
    { _id: entry._id, status: SERVICE_ENTRY_STATUS.PENDING },
    { $set: { status, decidedBy: oid(user.id), decidedAt: new Date(), decisionRemarks: req.body.remarks } },
    { new: true },
  );
  if (!decided) throw ApiError.unprocessable('This sign-off has already been decided');
  return decided;
}

/** Acceptance is what makes the work billable; an invoice already submitted is matched again. */
export const acceptServiceEntry = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const entry = await claimDecision(req, user, SERVICE_ENTRY_STATUS.ACCEPTED);
  await updatePurchaseOrder(entry.purchaseOrder, (po) => {
    const line = po.items.find((i) => i._id.equals(entry.poItem));
    if (!line) return;
    if (entry.type === 'SERVICE') {
      line.receivedQty = round2(line.receivedQty + entry.quantity);
      refreshReceiptStatus(po);
    } else {
      line.commissionedQty = round2(line.commissionedQty + entry.quantity);
    }
  });
  await rematchOpenInvoices(entry.purchaseOrder, user.id);
  res.json(entry);
});

export const rejectServiceEntry = asyncHandler(async (req, res) => {
  res.json(await claimDecision(req, currentUser(req), SERVICE_ENTRY_STATUS.REJECTED));
});
