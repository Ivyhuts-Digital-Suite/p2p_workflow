import { HydratedDocument, Schema, Types, model } from 'mongoose';
import { GRN_QUALITY_STATUS, GRN_STATUS, GrnQualityStatus, GrnStatus, enumValues } from '../constants/status';

export interface IGrnItem {
  _id: Types.ObjectId;
  poItem: Types.ObjectId;
  /** Product title, shown as "title x quantity". Optional: older lines have none and show the description. */
  title?: string;
  description: string;
  orderedQty: number;
  receivedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  rejectionReason?: string;
  /** Outcome of the physical quality / damage inspection */
  qualityStatus: GrnQualityStatus;
  /** Quantity still missing against the PO after this delivery */
  shortageQty: number;
  shortageReason?: string;
  batchNumber?: string;
  expiryDate?: Date;
  serialNumbers: string[];
  /** Only on GRNs from when QC was a separate step. Otherwise the Store's acceptedQty is what counts as released. */
  qcReleasedQty?: number;
  /** Only on GRNs from when QC was a separate step: accepted at the dock, then rejected by QC */
  qcRejectedQty: number;
  /** Rejected goods already sent back on a return note */
  returnedQty: number;
}

export interface IGoodsReceipt {
  grnNumber: string;
  purchaseOrder: Types.ObjectId;
  vendor: Types.ObjectId;
  warehouse: string;
  /** Vendor's invoice / delivery challan number from the shipment paperwork */
  deliveryNoteNumber?: string;
  /** Physical box / carton count at the dock */
  physicalCheck?: { boxesExpected: number; boxesCounted: number };
  items: IGrnItem[];
  status: GrnStatus;
  qcRemarks?: string;
  receivedBy: Types.ObjectId;
  receivedAt: Date;
}

export type GoodsReceiptDocument = HydratedDocument<IGoodsReceipt>;

const grnItemSchema = new Schema<IGrnItem>({
  poItem: { type: Schema.Types.ObjectId, required: true },
  title: String,
  description: { type: String, required: true },
  orderedQty: { type: Number, required: true },
  receivedQty: { type: Number, required: true, min: 0 },
  acceptedQty: { type: Number, required: true, min: 0 },
  rejectedQty: { type: Number, default: 0, min: 0 },
  rejectionReason: String,
  qualityStatus: { type: String, enum: enumValues(GRN_QUALITY_STATUS), default: GRN_QUALITY_STATUS.PASSED },
  shortageQty: { type: Number, default: 0, min: 0 },
  shortageReason: String,
  batchNumber: String,
  expiryDate: Date,
  serialNumbers: { type: [String], default: [] },
  qcReleasedQty: Number,
  qcRejectedQty: { type: Number, default: 0, min: 0 },
  returnedQty: { type: Number, default: 0, min: 0 },
});

const grnSchema = new Schema<IGoodsReceipt>(
  {
    grnNumber: { type: String, required: true, unique: true },
    purchaseOrder: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true, index: true },
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    warehouse: { type: String, required: true },
    deliveryNoteNumber: String,
    physicalCheck: { boxesExpected: Number, boxesCounted: Number },
    items: [grnItemSchema],
    status: { type: String, enum: enumValues(GRN_STATUS), required: true },
    qcRemarks: String,
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    receivedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export const GoodsReceipt = model<IGoodsReceipt>('GoodsReceipt', grnSchema);
