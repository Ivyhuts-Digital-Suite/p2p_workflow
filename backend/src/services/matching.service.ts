import { env } from '../config/env';
import { GRN_STATUS, ITEM_TYPE, MATCH_STATUS, MatchStatus, NEEDS_COMMISSIONING } from '../constants/status';
import { GoodsReceipt } from '../models/GoodsReceipt';
import { IMatchException, InvoiceDocument } from '../models/Invoice';
import { IPoItem, PurchaseOrder, PurchaseOrderDocument } from '../models/PurchaseOrder';
import { ApiError } from '../utils/ApiError';
import { calcOrderTotals, round2 } from '../utils/money';

export interface MatchResult {
  status: MatchStatus;
  exceptions: IMatchException[];
}

/**
 * What can be billed on each PO line so far, whether or not it already has been:
 *   - goods: accepted by the Store, so rejected goods never count
 *   - equipment: accepted by the Store and also commissioned
 *   - services: accepted by the department
 */
export async function clearedQuantities(pos: PurchaseOrderDocument[]): Promise<Map<string, number>> {
  const grns = await GoodsReceipt.find({
    purchaseOrder: { $in: pos.map((po) => po._id) },
    status: { $ne: GRN_STATUS.REJECTED },
  });
  const released = new Map<string, number>();
  for (const grn of grns) {
    for (const line of grn.items) {
      const key = line.poItem.toString();
      // A GRN from when QC was a separate step records what QC released. Otherwise what the Store accepted stands.
      released.set(key, (released.get(key) ?? 0) + (line.qcReleasedQty ?? line.acceptedQty));
    }
  }

  const cleared = new Map<string, number>();
  const clearedFor = (item: IPoItem) => {
    const fromGrn = released.get(item._id.toString()) ?? 0;
    if (item.itemType === ITEM_TYPE.SERVICE) return item.receivedQty;
    if (NEEDS_COMMISSIONING.includes(item.itemType)) return Math.min(fromGrn, item.commissionedQty);
    return fromGrn;
  };
  for (const po of pos) {
    for (const item of po.items) cleared.set(item._id.toString(), clearedFor(item));
  }
  return cleared;
}

/**
 * 3-way match: Purchase Order  vs  Goods Receipt(s)  vs  Vendor Invoice.
 *
 * For each invoice line:
 *   - the PO line must exist and belong to the same vendor
 *   - billed qty <= ordered qty not yet invoiced              (PO check)
 *   - billed qty <= accepted (GRN) qty not yet invoiced       (GRN check)
 *   - unit price within tolerance of PO price                 (price check)
 *   - GST rate equals PO tax rate
 * Header: vendor-claimed total must equal the recomputed total, and the invoice total
 * must equal the PO-priced value of the billed quantities (within tolerance).
 */
export async function performThreeWayMatch(invoice: InvoiceDocument): Promise<MatchResult> {
  const po = await PurchaseOrder.findById(invoice.purchaseOrder);
  if (!po) throw ApiError.notFound('Purchase order');

  const cleared = await clearedQuantities([po]);

  const exceptions: IMatchException[] = [];
  const tolerance = env.matchPriceTolerancePct;

  if (!invoice.vendor.equals(po.vendor)) {
    exceptions.push({ type: 'VENDOR_MISMATCH', message: 'Invoice vendor differs from PO vendor' });
  }

  const poPricedLines: { quantity: number; unitPrice: number; taxRate: number }[] = [];

  for (const line of invoice.items) {
    const poItem = po.items.find((i) => i._id.equals(line.poItem));
    if (!poItem) {
      exceptions.push({ type: 'ITEM_NOT_ON_PO', poItem: line.poItem, message: `"${line.description}" is not on the PO` });
      continue;
    }

    const openToInvoice = round2(poItem.quantity - poItem.invoicedQty);
    if (line.quantity > openToInvoice) {
      exceptions.push({
        type: 'QTY_EXCEEDS_ORDERED',
        poItem: poItem._id,
        message: `${poItem.description}: billed qty exceeds ordered qty still open for invoicing`,
        expected: openToInvoice,
        actual: line.quantity,
      });
    }

    const receivedNotInvoiced = round2((cleared.get(poItem._id.toString()) ?? 0) - poItem.invoicedQty);
    if (line.quantity > receivedNotInvoiced) {
      exceptions.push({
        type: 'QTY_EXCEEDS_RECEIVED',
        poItem: poItem._id,
        message: `${poItem.description}: billed qty exceeds the quantity accepted or signed off and not yet invoiced`,
        expected: Math.max(receivedNotInvoiced, 0),
        actual: line.quantity,
      });
    }

    const variancePct =
      poItem.unitPrice === 0 ? (line.unitPrice > 0 ? 100 : 0) : (Math.abs(line.unitPrice - poItem.unitPrice) / poItem.unitPrice) * 100;
    if (variancePct > tolerance) {
      exceptions.push({
        type: 'PRICE_VARIANCE',
        poItem: poItem._id,
        message: `${poItem.description}: unit price varies ${round2(variancePct)}% from PO (tolerance ${tolerance}%)`,
        expected: poItem.unitPrice,
        actual: line.unitPrice,
      });
    }

    if (line.taxRate !== poItem.taxRate) {
      exceptions.push({
        type: 'TAX_RATE_MISMATCH',
        poItem: poItem._id,
        message: `${poItem.description}: GST rate ${line.taxRate}% differs from PO rate ${poItem.taxRate}%`,
        expected: poItem.taxRate,
        actual: line.taxRate,
      });
    }

    poPricedLines.push({ quantity: line.quantity, unitPrice: poItem.unitPrice, taxRate: poItem.taxRate });
  }

  if (Math.abs(invoice.claimedTotal - invoice.total) > 1) {
    exceptions.push({
      type: 'TOTAL_MISMATCH',
      message: 'Invoice header total does not equal the sum of its lines',
      expected: invoice.total,
      actual: invoice.claimedTotal,
    });
  }

  const expectedTotal = calcOrderTotals(poPricedLines).grandTotal;
  if (expectedTotal > 0 && (Math.abs(invoice.total - expectedTotal) / expectedTotal) * 100 > tolerance) {
    exceptions.push({
      type: 'TOTAL_MISMATCH',
      message: 'Invoice total differs from PO-priced value of billed quantities beyond tolerance',
      expected: expectedTotal,
      actual: invoice.total,
    });
  }

  return {
    status: exceptions.length === 0 ? MATCH_STATUS.MATCHED : MATCH_STATUS.EXCEPTION,
    exceptions,
  };
}
