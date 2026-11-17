import { HydratedDocument, Schema, Types, model } from 'mongoose';
import { Role } from '../constants/roles';
import { APPROVAL_STATUS, ApprovalStatus, ITEM_TYPE, ItemType, PO_STATUS, PoStatus, enumValues } from '../constants/status';
import { calcOrderTotals, round2 } from '../utils/money';

export interface IPoItem {
  _id: Types.ObjectId;
  rfqItem?: Types.ObjectId;
  itemCode?: string;
  /** Product title, shown as "title x quantity". Optional: older lines have none and show the description. */
  title?: string;
  description: string;
  quantity: number;
  uom: string;
  unitPrice: number;
  taxRate: number;
  lineTotal: number;
  itemType: ItemType;
  /** Cumulative accepted quantity: goods accepted by the Store, and accepted service entries */
  receivedQty: number;
  /** Cumulative quantity on booked invoices */
  invoicedQty: number;
  /** Cumulative quantity with an accepted commissioning sign-off (equipment lines) */
  commissionedQty: number;
}

export interface IPoApproval {
  level: number;
  role: Role;
  status: ApprovalStatus;
  actedBy?: Types.ObjectId;
  actedAt?: Date;
  remarks?: string;
}

export interface IPurchaseOrder {
  poNumber: string;
  rfq: Types.ObjectId;
  bid: Types.ObjectId;
  vendor: Types.ObjectId;
  department: Types.ObjectId;
  requisitions: Types.ObjectId[];
  items: IPoItem[];
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  currency: string;
  deliveryAddress?: string;
  expectedDeliveryDate?: Date;
  paymentTerms: string;
  doaRule?: Types.ObjectId;
  approvals: IPoApproval[];
  status: PoStatus;
  issuedAt?: Date;
  acknowledgedAt?: Date;
  createdBy: Types.ObjectId;
  isEmergency: boolean;
  /** Copied from the RFQ, so cancelling the PO can undo the budget change made at award */
  budgetVariance?: number;
  shortClose?: { reason: string; by: Types.ObjectId; at: Date; releasedBudget: number };
}

export type PurchaseOrderDocument = HydratedDocument<IPurchaseOrder>;

const poItemSchema = new Schema<IPoItem>({
  rfqItem: Schema.Types.ObjectId,
  itemCode: String,
  title: String,
  description: { type: String, required: true },
  quantity: { type: Number, required: true, min: 0.0001 },
  uom: { type: String, default: 'EA' },
  unitPrice: { type: Number, required: true, min: 0 },
  taxRate: { type: Number, default: 18, min: 0 },
  lineTotal: { type: Number, default: 0 },
  itemType: { type: String, enum: enumValues(ITEM_TYPE), default: ITEM_TYPE.GOODS },
  receivedQty: { type: Number, default: 0, min: 0 },
  invoicedQty: { type: Number, default: 0, min: 0 },
  commissionedQty: { type: Number, default: 0, min: 0 },
});

const approvalSchema = new Schema<IPoApproval>(
  {
    level: { type: Number, required: true },
    // Not limited to current roles: a past approval keeps the role that gave it, even one since merged.
    role: { type: String, required: true },
    status: { type: String, enum: enumValues(APPROVAL_STATUS), default: APPROVAL_STATUS.PENDING },
    actedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    actedAt: Date,
    remarks: String,
  },
  { _id: false },
);

const poSchema = new Schema<IPurchaseOrder>(
  {
    poNumber: { type: String, required: true, unique: true },
    rfq: { type: Schema.Types.ObjectId, ref: 'RFQ', required: true },
    // Not unique: cancelled POs keep their bid reference for audit.
    bid: { type: Schema.Types.ObjectId, ref: 'Bid', required: true, index: true },
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    department: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
    requisitions: [{ type: Schema.Types.ObjectId, ref: 'PurchaseRequisition' }],
    items: [poItemSchema],
    subtotal: { type: Number, default: 0 },
    taxTotal: { type: Number, default: 0 },
    grandTotal: { type: Number, default: 0 },
    currency: { type: String, default: 'INR' },
    deliveryAddress: String,
    expectedDeliveryDate: Date,
    paymentTerms: { type: String, default: 'Net 30' },
    doaRule: { type: Schema.Types.ObjectId, ref: 'DoaRule' },
    approvals: [approvalSchema],
    status: { type: String, enum: enumValues(PO_STATUS), default: PO_STATUS.PENDING_APPROVAL, index: true },
    issuedAt: Date,
    acknowledgedAt: Date,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    isEmergency: { type: Boolean, default: false },
    budgetVariance: Number,
    shortClose: {
      reason: String,
      by: { type: Schema.Types.ObjectId, ref: 'User' },
      at: Date,
      releasedBudget: Number,
    },
  },
  { timestamps: true, optimisticConcurrency: true },
);

// A bid has one live PO, enforced by the database so concurrent requests cannot create two.
// SHORT_CLOSED stays out of the filter: a filter change would conflict with the index on existing
// databases, and a short-closed PO is never replaced because it only follows a live one.
poSchema.index(
  { bid: 1 },
  {
    unique: true,
    name: 'one_live_po_per_bid',
    partialFilterExpression: {
      status: { $in: enumValues(PO_STATUS).filter((s) => s !== PO_STATUS.CANCELLED && s !== PO_STATUS.SHORT_CLOSED) },
    },
  },
);

poSchema.pre('validate', function () {
  for (const item of this.items) {
    item.lineTotal = round2(item.quantity * item.unitPrice);
  }
  Object.assign(this, calcOrderTotals(this.items));
});

export const PurchaseOrder = model<IPurchaseOrder>('PurchaseOrder', poSchema);
