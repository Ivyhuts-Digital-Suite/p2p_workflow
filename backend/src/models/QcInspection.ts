import { HydratedDocument, Schema, Types, model } from 'mongoose';
import { QC_STATUS, QcStatus, enumValues } from '../constants/status';

/**
 * History from when QC was a separate role. The Store now inspects at receipt, so nothing new is written here:
 * the model remains so the migration can settle old inspections, and their records stay on file.
 */
export interface IQcInspection {
  inspectionNumber: string;
  grn: Types.ObjectId;
  grnLine: Types.ObjectId;
  purchaseOrder: Types.ObjectId;
  poItem: Types.ObjectId;
  vendor: Types.ObjectId;
  warehouse: string;
  description: string;
  batchNumber?: string;
  expiryDate?: Date;
  serialNumbers: string[];
  quantity: number;
  status: QcStatus;
  releasedQty: number;
  rejectedQty: number;
  remarks?: string;
  receivedBy: Types.ObjectId;
  decidedBy?: Types.ObjectId;
  decidedAt?: Date;
}

export type QcInspectionDocument = HydratedDocument<IQcInspection>;

const qcInspectionSchema = new Schema<IQcInspection>(
  {
    inspectionNumber: { type: String, required: true, unique: true },
    grn: { type: Schema.Types.ObjectId, ref: 'GoodsReceipt', required: true, index: true },
    grnLine: { type: Schema.Types.ObjectId, required: true },
    purchaseOrder: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true, index: true },
    poItem: { type: Schema.Types.ObjectId, required: true },
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    warehouse: { type: String, required: true },
    description: { type: String, required: true },
    batchNumber: String,
    expiryDate: Date,
    serialNumbers: { type: [String], default: [] },
    quantity: { type: Number, required: true, min: 0 },
    status: { type: String, enum: enumValues(QC_STATUS), default: QC_STATUS.PENDING, index: true },
    releasedQty: { type: Number, default: 0, min: 0 },
    rejectedQty: { type: Number, default: 0, min: 0 },
    remarks: String,
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: Date,
  },
  { timestamps: true },
);

export const QcInspection = model<IQcInspection>('QcInspection', qcInspectionSchema);
