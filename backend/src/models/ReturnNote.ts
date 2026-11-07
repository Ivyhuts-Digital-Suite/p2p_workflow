import { Schema, Types, model } from 'mongoose';
import { RETURN_STATUS, ReturnStatus, enumValues } from '../constants/status';

/** Rejected goods going back to the vendor. REPLACE expects a new delivery; CREDIT expects a debit or credit note. */
export interface IReturnNote {
  returnNumber: string;
  grn: Types.ObjectId;
  grnLine: Types.ObjectId;
  purchaseOrder: Types.ObjectId;
  vendor: Types.ObjectId;
  description: string;
  quantity: number;
  reason: string;
  resolution: 'REPLACE' | 'CREDIT';
  status: ReturnStatus;
  carrierReference?: string;
  raisedBy: Types.ObjectId;
  dispatchedBy?: Types.ObjectId;
  dispatchedAt?: Date;
}

const returnNoteSchema = new Schema<IReturnNote>(
  {
    returnNumber: { type: String, required: true, unique: true },
    grn: { type: Schema.Types.ObjectId, ref: 'GoodsReceipt', required: true, index: true },
    grnLine: { type: Schema.Types.ObjectId, required: true },
    purchaseOrder: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true, index: true },
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    description: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0.0001 },
    reason: { type: String, required: true },
    resolution: { type: String, enum: ['REPLACE', 'CREDIT'], required: true },
    status: { type: String, enum: enumValues(RETURN_STATUS), default: RETURN_STATUS.RAISED },
    carrierReference: String,
    raisedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    dispatchedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    dispatchedAt: Date,
  },
  { timestamps: true },
);

export const ReturnNote = model<IReturnNote>('ReturnNote', returnNoteSchema);
