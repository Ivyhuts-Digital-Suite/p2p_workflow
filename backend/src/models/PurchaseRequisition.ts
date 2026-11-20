import { HydratedDocument, Schema, Types, model } from 'mongoose';
import { Role } from '../constants/roles';
import {
  APPROVAL_STATUS,
  ApprovalStatus,
  ITEM_TYPE,
  ItemType,
  PR_PRIORITY,
  PR_STATUS,
  PrStatus,
  RATIFICATION_STATUS,
  RatificationStatus,
  enumValues,
} from '../constants/status';
import { round2 } from '../utils/money';

export interface IPrItem {
  _id: Types.ObjectId;
  /** Product title, shown as "title x quantity". Optional: older lines have none and show the description. */
  title?: string;
  description: string;
  category?: string;
  quantity: number;
  uom: string;
  estimatedUnitPrice: number;
  estimatedTotal: number;
  itemType: ItemType;
}

export interface IPrApproval {
  level: number;
  role: Role;
  status: ApprovalStatus;
  actedBy?: Types.ObjectId;
  actedAt?: Date;
  remarks?: string;
}

export interface IAuditEntry {
  action: string;
  by: Types.ObjectId;
  at: Date;
  remarks?: string;
}

export interface IPurchaseRequisition {
  prNumber: string;
  title: string;
  justification?: string;
  department: Types.ObjectId;
  requester: Types.ObjectId;
  items: IPrItem[];
  totalEstimate: number;
  currency: string;
  neededBy?: Date;
  priority: string;
  status: PrStatus;
  /** Legacy: PRs could once be deactivated. Kept for old records; no longer read or set. */
  isActive: boolean;
  /** Ordered approval chain, set on submission: the HOD, then any levels from a PR DoA rule */
  approvals: IPrApproval[];
  approval?: { by: Types.ObjectId; at: Date; remarks?: string };
  cancellation?: { by: Types.ObjectId; at: Date; reason: string };
  rfq?: Types.ObjectId;
  purchaseOrder?: Types.ObjectId;
  history: IAuditEntry[];
  /** Urgent clinical need: HOD approval only, then a capped direct PO, ratified by Finance afterwards */
  isEmergency: boolean;
  emergencyReason?: string;
  ratification?: { status: RatificationStatus; by?: Types.ObjectId; at?: Date; remarks?: string };
}

export type PurchaseRequisitionDocument = HydratedDocument<IPurchaseRequisition>;

export const auditEntrySchema = new Schema<IAuditEntry>(
  {
    action: { type: String, required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    at: { type: Date, default: Date.now },
    remarks: String,
  },
  { _id: false },
);

const prItemSchema = new Schema<IPrItem>({
  title: { type: String, trim: true },
  description: { type: String, required: true, trim: true },
  category: String,
  quantity: { type: Number, required: true, min: 0.0001 },
  uom: { type: String, default: 'EA' },
  estimatedUnitPrice: { type: Number, required: true, min: 0 },
  estimatedTotal: { type: Number, default: 0 },
  itemType: { type: String, enum: enumValues(ITEM_TYPE), default: ITEM_TYPE.GOODS },
});

const prApprovalSchema = new Schema<IPrApproval>(
  {
    level: { type: Number, required: true },
    role: { type: String, required: true },
    status: { type: String, enum: enumValues(APPROVAL_STATUS), default: APPROVAL_STATUS.PENDING },
    actedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    actedAt: Date,
    remarks: String,
  },
  { _id: false },
);

const prSchema = new Schema<IPurchaseRequisition>(
  {
    prNumber: { type: String, required: true, unique: true },
    title: { type: String, required: true, trim: true },
    justification: String,
    department: { type: Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    requester: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    items: {
      type: [prItemSchema],
      validate: [(v: unknown[]) => v.length > 0, 'At least one line item is required'],
    },
    totalEstimate: { type: Number, default: 0 },
    currency: { type: String, default: 'INR' },
    neededBy: Date,
    priority: { type: String, enum: enumValues(PR_PRIORITY), default: PR_PRIORITY.MEDIUM },
    status: { type: String, enum: enumValues(PR_STATUS), default: PR_STATUS.DRAFT, index: true },
    isActive: { type: Boolean, default: true },
    approvals: [prApprovalSchema],
    isEmergency: { type: Boolean, default: false },
    emergencyReason: String,
    ratification: {
      status: { type: String, enum: enumValues(RATIFICATION_STATUS) },
      by: { type: Schema.Types.ObjectId, ref: 'User' },
      at: Date,
      remarks: String,
    },
    approval: { by: { type: Schema.Types.ObjectId, ref: 'User' }, at: Date, remarks: String },
    cancellation: { by: { type: Schema.Types.ObjectId, ref: 'User' }, at: Date, reason: String },
    rfq: { type: Schema.Types.ObjectId, ref: 'RFQ' },
    purchaseOrder: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder' },
    history: [auditEntrySchema],
  },
  // Optimistic concurrency stops two simultaneous approvals from committing the budget twice.
  { timestamps: true, optimisticConcurrency: true },
);

prSchema.pre('validate', function () {
  let total = 0;
  for (const item of this.items) {
    item.estimatedTotal = round2(item.quantity * item.estimatedUnitPrice);
    total += item.estimatedTotal;
  }
  this.totalEstimate = round2(total);
});

export const PurchaseRequisition = model<IPurchaseRequisition>('PurchaseRequisition', prSchema);
