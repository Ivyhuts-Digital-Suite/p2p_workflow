import { HydratedDocument, Schema, Types, model } from 'mongoose';
import { BID_STATUS, BidStatus, enumValues } from '../constants/status';
import { calcOrderTotals, round2 } from '../utils/money';

export interface IBidItem {
  _id: Types.ObjectId;
  rfqItem: Types.ObjectId;
  quantity: number;
  unitPrice: number;
  /** GST the vendor quotes on this line (%) */
  taxRate: number;
  lineTotal: number;
}

export interface IBid {
  rfq: Types.ObjectId;
  vendor: Types.ObjectId;
  items: IBidItem[];
  /** Pre-tax quoted value - the basis for price comparison */
  totalAmount: number;
  taxAmount: number;
  /** Pre-tax value plus GST. Bids are ranked on totalAmount, because input GST is recoverable. */
  grandTotal: number;
  deliveryDays: number;
  validityDays: number;
  notes?: string;
  /** Quality score (0-100) assigned by procurement */
  qualityScore?: number;
  /** Computed: (lowest total / this total) x 100 */
  priceScore?: number;
  /** Computed: position by lowest price, 1 = L1 */
  rank?: number;
  revision: number;
  status: BidStatus;
  submittedBy: Types.ObjectId;
  submittedAt: Date;
}

export type BidDocument = HydratedDocument<IBid>;

const bidItemSchema = new Schema<IBidItem>({
  rfqItem: { type: Schema.Types.ObjectId, required: true },
  quantity: { type: Number, required: true, min: 0.0001 },
  unitPrice: { type: Number, required: true, min: 0 },
  taxRate: { type: Number, default: 18, min: 0 },
  lineTotal: { type: Number, default: 0 },
});

const bidSchema = new Schema<IBid>(
  {
    rfq: { type: Schema.Types.ObjectId, ref: 'RFQ', required: true },
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    items: [bidItemSchema],
    totalAmount: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    grandTotal: { type: Number, default: 0 },
    deliveryDays: { type: Number, required: true, min: 0 },
    validityDays: { type: Number, default: 30, min: 1 },
    notes: String,
    qualityScore: { type: Number, min: 0, max: 100 },
    priceScore: Number,
    rank: Number,
    revision: { type: Number, default: 1 },
    status: { type: String, enum: enumValues(BID_STATUS), default: BID_STATUS.SUBMITTED, index: true },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    submittedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// One bid per vendor per RFQ; vendors revise their existing bid instead of creating new ones.
bidSchema.index({ rfq: 1, vendor: 1 }, { unique: true });

bidSchema.pre('validate', function () {
  for (const item of this.items) {
    item.lineTotal = round2(item.quantity * item.unitPrice);
  }
  const totals = calcOrderTotals(this.items);
  this.totalAmount = totals.subtotal;
  this.taxAmount = totals.taxTotal;
  this.grandTotal = totals.grandTotal;
});

export const Bid = model<IBid>('Bid', bidSchema);
