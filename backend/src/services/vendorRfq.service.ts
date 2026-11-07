import { BID_STATUS, RFQ_STATUS } from '../constants/status';
import { Bid } from '../models/Bid';
import { PurchaseOrder } from '../models/PurchaseOrder';
import { RfqDocument } from '../models/RFQ';
import { AuthUser } from '../types/auth';
import { vendorPoScope } from './purchaseOrder.service';

/**
 * An award is visible only to the winning vendor. To everyone else the RFQ just reads as closed,
 * and it reads that way from the moment bidding ends, so the change of status can't reveal an award.
 */
export function vendorRfqStatus(rfq: RfqDocument, won: boolean, now = new Date()) {
  if (rfq.status === RFQ_STATUS.AWARDED) return won ? RFQ_STATUS.AWARDED : RFQ_STATUS.CLOSED;
  if (rfq.status === RFQ_STATUS.PUBLISHED && now >= rfq.closeAt) return RFQ_STATUS.CLOSED;
  return rfq.status;
}

/** Built field by field so that nothing about the award or the buyer's internals reaches a vendor by default. */
export async function vendorRfqViews(rfqs: RfqDocument[], user: AuthUser) {
  const wonRfqIds = await Bid.find({ rfq: { $in: rfqs.map((r) => r._id) }, vendor: user.vendor, status: BID_STATUS.AWARDED }).distinct('rfq');
  const won = new Set(wonRfqIds.map(String));
  const isWon = (rfq: RfqDocument) => rfq.status === RFQ_STATUS.AWARDED && won.has(rfq._id.toString());

  const pos = await PurchaseOrder.find({
    $and: [{ _id: { $in: rfqs.filter(isWon).map((r) => r.purchaseOrder) } }, vendorPoScope(user.vendor)],
  }).select('poNumber status');
  const poById = new Map(pos.map((po) => [po._id.toString(), po]));

  return rfqs.map((rfq) => ({
    _id: rfq._id,
    rfqNumber: rfq.rfqNumber,
    title: rfq.title,
    description: rfq.description,
    department: rfq.department,
    items: rfq.items.map((i) => ({
      _id: i._id,
      itemCode: i.itemCode,
      description: i.description,
      quantity: i.quantity,
      uom: i.uom,
      specifications: i.specifications,
      itemType: i.itemType,
    })),
    openAt: rfq.openAt,
    closeAt: rfq.closeAt,
    status: vendorRfqStatus(rfq, isWon(rfq)),
    requiredLicences: rfq.requiredLicences,
    ...(isWon(rfq) && { awardedAt: rfq.awardedAt, purchaseOrder: poById.get(rfq.purchaseOrder?.toString() ?? '') }),
  }));
}
