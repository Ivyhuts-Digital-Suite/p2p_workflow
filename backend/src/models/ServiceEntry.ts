import { HydratedDocument, Schema, Types, model } from 'mongoose';
import { SERVICE_ENTRY_STATUS, ServiceEntryStatus, enumValues } from '../constants/status';

/** Proof that a service was performed, or that equipment was installed and works. Needed before billing. */
export interface IServiceEntry {
  entryNumber: string;
  type: 'SERVICE' | 'COMMISSIONING';
  purchaseOrder: Types.ObjectId;
  poItem: Types.ObjectId;
  vendor: Types.ObjectId;
  department: Types.ObjectId;
  description: string;
  quantity: number;
  completedOn: Date;
  remarks?: string;
  status: ServiceEntryStatus;
  raisedBy: Types.ObjectId;
  decidedBy?: Types.ObjectId;
  decidedAt?: Date;
  decisionRemarks?: string;
}

export type ServiceEntryDocument = HydratedDocument<IServiceEntry>;

const serviceEntrySchema = new Schema<IServiceEntry>(
  {
    entryNumber: { type: String, required: true, unique: true },
    type: { type: String, enum: ['SERVICE', 'COMMISSIONING'], required: true },
    purchaseOrder: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true, index: true },
    poItem: { type: Schema.Types.ObjectId, required: true },
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    department: { type: Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    description: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0.0001 },
    completedOn: { type: Date, required: true },
    remarks: String,
    status: { type: String, enum: enumValues(SERVICE_ENTRY_STATUS), default: SERVICE_ENTRY_STATUS.PENDING, index: true },
    raisedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: Date,
    decisionRemarks: String,
  },
  { timestamps: true },
);

export const ServiceEntry = model<IServiceEntry>('ServiceEntry', serviceEntrySchema);
