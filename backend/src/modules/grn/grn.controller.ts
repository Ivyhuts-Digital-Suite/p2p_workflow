import { FilterQuery } from 'mongoose';
import { env } from '../../config/env';
import { ROLES } from '../../constants/roles';
import { BATCH_TRACKED, GRN_STATUS, GrnQualityStatus, ITEM_TYPE, PO_STATUS, RETURN_STATUS, SERIAL_TRACKED } from '../../constants/status';
import { currentUser } from '../../middleware/auth';
import { GoodsReceipt, IGoodsReceipt } from '../../models/GoodsReceipt';
import { InventoryItem } from '../../models/InventoryItem';
import { PurchaseOrder } from '../../models/PurchaseOrder';
import { IReturnNote, ReturnNote } from '../../models/ReturnNote';
import { rematchOpenInvoices } from '../../services/matching.service';
import { refreshReceiptStatus } from '../../services/purchaseOrder.service';
import { ApiError } from '../../utils/ApiError';
import { asyncHandler } from '../../utils/asyncHandler';
import { round2 } from '../../utils/money';
import { oid } from '../../utils/objectId';
import { nextDocNumber } from '../../utils/sequence';

const RECEIVABLE: string[] = [PO_STATUS.ISSUED, PO_STATUS.ACKNOWLEDGED, PO_STATUS.PARTIALLY_RECEIVED];
const DAY_MS = 86_400_000;

interface GrnLineInput {
  poItemId: string;
  receivedQty: number;
  acceptedQty: number;
  qualityStatus: GrnQualityStatus;
  rejectionReason?: string;
  shortageReason?: string;
  batchNumber?: string;
  expiryDate?: Date;
  serialNumbers: string[];
}

/** Batch and expiry for drugs and consumables; one serial per unit for devices and equipment. Expired goods are never accepted. */
function assertTraceable(line: GrnLineInput, description: string, itemType: string) {
  if (line.acceptedQty === 0) return;
  if (BATCH_TRACKED.includes(itemType) && (!line.batchNumber || !line.expiryDate)) {
    throw ApiError.unprocessable(`${description}: enter the batch number and expiry date`);
  }
  if (line.expiryDate && line.expiryDate <= new Date()) {
    throw ApiError.unprocessable(`${description}: batch ${line.batchNumber ?? ''} has expired and cannot be accepted. Reject the quantity instead.`);
  }
  if (SERIAL_TRACKED.includes(itemType)) {
    if (line.serialNumbers.length !== line.acceptedQty) {
      throw ApiError.unprocessable(`${description}: enter one serial number for each of the ${line.acceptedQty} accepted units`);
    }
    if (new Set(line.serialNumbers).size !== line.serialNumbers.length) {
      throw ApiError.unprocessable(`${description}: serial numbers must be unique`);
    }
  }
}

/**
 * Store verifies physical goods against the PO: box count, quantity, quality and damage, batch, expiry and
 * serials. This is the quality inspection: what the Store accepts goes straight into stock and becomes
 * billable, and what it rejects is recorded with a reason and can be returned to the vendor.
 */
export const createGrn = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const { purchaseOrderId, warehouse, deliveryNoteNumber, physicalCheck, qcRemarks, photos } = req.body;
  const lines: GrnLineInput[] = req.body.items;

  const po = await PurchaseOrder.findById(purchaseOrderId);
  if (!po) throw ApiError.notFound('Purchase order');
  if (!RECEIVABLE.includes(po.status)) {
    throw ApiError.unprocessable(`Goods cannot be received against a PO that is ${po.status}`);
  }

  const seen = new Set<string>();
  const items = lines.map((line) => {
    if (seen.has(line.poItemId)) throw ApiError.unprocessable('Each PO line may appear only once per GRN');
    seen.add(line.poItemId);

    const poItem = po.items.find((i) => i._id.equals(line.poItemId));
    if (!poItem) throw ApiError.unprocessable(`PO line ${line.poItemId} not found`);
    if (poItem.itemType === ITEM_TYPE.SERVICE) {
      throw ApiError.unprocessable(`${poItem.description} is a service: record it as a service sign-off, not a goods receipt`);
    }
    assertTraceable(line, poItem.description, poItem.itemType);

    const outstanding = round2(poItem.quantity - poItem.receivedQty);
    if (line.acceptedQty > outstanding) {
      throw ApiError.unprocessable(`${poItem.description}: accepting ${line.acceptedQty} exceeds outstanding qty ${outstanding}`);
    }
    const shortageQty = round2(Math.max(outstanding - line.receivedQty, 0));
    if (shortageQty > 0 && !line.shortageReason) {
      throw ApiError.unprocessable(`${poItem.description}: enter a reason for the shortage of ${shortageQty}`);
    }
    return {
      poItem: poItem._id,
      title: poItem.title,
      description: poItem.description,
      orderedQty: poItem.quantity,
      receivedQty: line.receivedQty,
      acceptedQty: line.acceptedQty,
      rejectedQty: round2(line.receivedQty - line.acceptedQty),
      rejectionReason: line.rejectionReason,
      qualityStatus: line.qualityStatus,
      shortageQty,
      shortageReason: shortageQty > 0 ? line.shortageReason : undefined,
      batchNumber: line.batchNumber,
      expiryDate: line.expiryDate,
      serialNumbers: line.serialNumbers,
    };
  });

  const serials = items.flatMap((i) => i.serialNumbers);
  if (serials.length && (await GoodsReceipt.exists({ purchaseOrder: po._id, 'items.serialNumbers': { $in: serials } }))) {
    throw ApiError.conflict('A serial number on this delivery has already been received on this PO');
  }

  const totalAccepted = items.reduce((s, i) => s + i.acceptedQty, 0);
  const totalRejected = items.reduce((s, i) => s + i.rejectedQty, 0);
  const status =
    totalAccepted === 0 ? GRN_STATUS.REJECTED : totalRejected > 0 ? GRN_STATUS.PARTIALLY_ACCEPTED : GRN_STATUS.ACCEPTED;

  // Apply receipt progress to the PO first. The PO schema uses optimistic concurrency,
  // so a concurrent GRN on the same PO fails with a version conflict instead of over-receiving.
  const grnNumber = await nextDocNumber('MW-GRN');
  for (const line of items) {
    const poItem = po.items.find((i) => i._id.equals(line.poItem))!;
    poItem.receivedQty = round2(poItem.receivedQty + line.acceptedQty);
  }
  if (po.items.some((i) => i.receivedQty > 0)) refreshReceiptStatus(po);
  await po.save();

  const grn = await GoodsReceipt.create({
    grnNumber,
    purchaseOrder: po._id,
    vendor: po.vendor,
    warehouse,
    deliveryNoteNumber,
    physicalCheck,
    qcRemarks,
    photos,
    items,
    status,
    receivedBy: user.id,
  });

  // Post accepted goods to inventory, with their batch, expiry and serials.
  for (const line of grn.items) {
    if (line.acceptedQty === 0) continue;
    const poItem = po.items.find((i) => i._id.equals(line.poItem))!;
    const itemKey = poItem.description.trim().toUpperCase();
    await InventoryItem.findOneAndUpdate(
      { itemKey, warehouse },
      {
        $inc: { quantity: line.acceptedQty },
        $set: { description: poItem.description, uom: poItem.uom, lastGrn: grn._id, lastReceivedAt: new Date() },
        $push: {
          batches: {
            batchNumber: line.batchNumber,
            expiryDate: line.expiryDate,
            serialNumbers: line.serialNumbers,
            quantity: line.acceptedQty,
            grn: grn._id,
          },
        },
      },
      { upsert: true },
    );
  }

  // The vendor's invoice usually came first: match it now that the goods are in.
  await rematchOpenInvoices(po._id, user.id);
  res.status(201).json(grn);
});

export const listGrns = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const filter: FilterQuery<IGoodsReceipt> = user.role === ROLES.VENDOR ? { vendor: user.vendor } : {};
  if (req.query.purchaseOrder) filter.purchaseOrder = String(req.query.purchaseOrder);

  const grns = await GoodsReceipt.find(filter)
    .populate('purchaseOrder', 'poNumber')
    .populate('vendor', 'companyName vendorCode contactPerson')
    .populate('receivedBy', 'name')
    .sort({ createdAt: -1 });
  res.json(grns);
});

export const getGrn = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const filter: FilterQuery<IGoodsReceipt> = { _id: req.params.id };
  if (user.role === ROLES.VENDOR) filter.vendor = user.vendor;

  const grn = await GoodsReceipt.findOne(filter)
    .populate('purchaseOrder', 'poNumber items')
    .populate('vendor', 'companyName vendorCode contactPerson')
    .populate('receivedBy', 'name');
  if (!grn) throw ApiError.notFound('Goods receipt');
  res.json(grn);
});

export const listInventory = asyncHandler(async (req, res) => {
  const filter = req.query.warehouse ? { warehouse: String(req.query.warehouse) } : {};
  res.json(await InventoryItem.find(filter).sort({ warehouse: 1, itemKey: 1 }));
});

/** Batches in stock that have expired or expire within the window, soonest first. */
export const nearExpiryReport = asyncHandler(async (req, res) => {
  const days = Number(req.query.days) > 0 ? Number(req.query.days) : env.nearExpiryDays;
  const now = Date.now();
  const cutoff = new Date(now + days * DAY_MS);
  const stock = await InventoryItem.find({ 'batches.expiryDate': { $lte: cutoff } });

  const rows = stock.flatMap((item) =>
    item.batches
      .filter((b) => b.expiryDate && b.expiryDate <= cutoff && b.quantity > 0)
      .map((b) => ({
        description: item.description,
        warehouse: item.warehouse,
        uom: item.uom,
        batchNumber: b.batchNumber,
        expiryDate: b.expiryDate,
        quantity: b.quantity,
        daysLeft: Math.ceil((b.expiryDate!.getTime() - now) / DAY_MS),
        expired: b.expiryDate!.getTime() <= now,
      })),
  );
  rows.sort((a, b) => a.daysLeft - b.daysLeft);
  res.json({ days, rows });
});

// ---- Returns to vendor -----------------------------------------------------------

/** Sends rejected goods back, and only as many as remain unreturned. */
export const createReturn = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const { grnLineId, quantity, reason, resolution } = req.body;
  const grn = await GoodsReceipt.findById(req.params.id);
  if (!grn) throw ApiError.notFound('Goods receipt');
  const line = grn.items.find((i) => i._id.equals(grnLineId));
  if (!line) throw ApiError.notFound('GRN line');

  const rejected = round2(line.rejectedQty + (line.qcRejectedQty ?? 0));
  const limit = round2(rejected - quantity);
  if (limit < 0) throw ApiError.unprocessable(`Only ${rejected} of ${line.description} was rejected on this GRN`);
  // The condition holds the line to its limit in one update, so two simultaneous returns cannot exceed it.
  const claimed = await GoodsReceipt.updateOne(
    { _id: grn._id, items: { $elemMatch: { _id: line._id, returnedQty: { $not: { $gt: limit } } } } },
    { $inc: { 'items.$.returnedQty': quantity } },
  );
  if (!claimed.modifiedCount) {
    throw ApiError.unprocessable(`${line.description}: this would return more than the ${rejected} that was rejected`);
  }

  const note = await ReturnNote.create({
    returnNumber: await nextDocNumber('RTN'),
    grn: grn._id,
    grnLine: line._id,
    purchaseOrder: grn.purchaseOrder,
    vendor: grn.vendor,
    description: line.description,
    quantity,
    reason,
    resolution,
    raisedBy: user.id,
  });
  res.status(201).json(note);
});

export const listReturns = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const filter: FilterQuery<IReturnNote> = user.role === ROLES.VENDOR ? { vendor: user.vendor } : {};
  const notes = await ReturnNote.find(filter)
    .populate('purchaseOrder', 'poNumber')
    .populate('grn', 'grnNumber')
    .populate('vendor', 'companyName contactPerson')
    .sort({ createdAt: -1 });
  res.json(notes);
});

export const dispatchReturn = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const note = await ReturnNote.findOneAndUpdate(
    { _id: req.params.id, status: RETURN_STATUS.RAISED },
    { $set: { status: RETURN_STATUS.DISPATCHED, carrierReference: req.body.carrierReference, dispatchedBy: oid(user.id), dispatchedAt: new Date() } },
    { new: true },
  );
  if (!note) throw ApiError.unprocessable('This return is not waiting to be dispatched');
  res.json(note);
});
