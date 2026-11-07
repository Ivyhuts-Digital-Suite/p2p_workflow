import { HydratedDocument, Schema, Types, model } from 'mongoose';
import { ESCALATION_STATUS, EscalationStatus, ITEM_TYPE, ItemType, LICENCE_TYPES, LicenceType, RFQ_STATUS, RfqStatus, enumValues } from '../constants/status';

export interface IRfqItem {
  _id: Types.ObjectId;
  itemCode?: string;
  description: string;
  quantity: number;
  uom: string;
  specifications?: string;
  itemType: ItemType;
  sourcePr: Types.ObjectId;
  sourcePrItem: Types.ObjectId;
}

/** Procurement's request to Finance for more budget, when the chosen quote does not fit what is left. */
export interface IBudgetEscalation {
  status: EscalationStatus;
  bid: Types.ObjectId;
  overrun: number;
  shortfall: number;
  reason: string;
  requestedBy: Types.ObjectId;
  requestedAt: Date;
  decidedBy?: Types.ObjectId;
  decidedAt?: Date;
  remarks?: string;
}

export interface IRfq {
  rfqNumber: string;
  title: string;
  description?: string;
  department: Types.ObjectId;
  requisitions: Types.ObjectId[];
  items: IRfqItem[];
  /** Empty list means an open tender visible to every approved vendor */
  invitedVendors: Types.ObjectId[];
  openAt: Date;
  closeAt: Date;
  status: RfqStatus;
  awardedBid?: Types.ObjectId;
  /** Written reason for awarding to a bid other than L1 */
  awardJustification?: string;
  awardedBy?: Types.ObjectId;
  awardedAt?: Date;
  /** The PO generated from the award */
  purchaseOrder?: Types.ObjectId;
  createdBy: Types.ObjectId;
  /** Two-envelope tender: prices stay sealed until the technical review is done and financials are opened */
  technicalEvaluation: boolean;
  financialsOpenedAt?: Date;
  financialsOpenedBy?: Types.ObjectId;
  /** A vendor needs a verified, unexpired licence of each of these types to bid or be awarded */
  requiredLicences: LicenceType[];
  /** Raised through the emergency route: one direct quote, no competition */
  isEmergency: boolean;
  /** Awarded value minus the PR estimates, added to the budget commitment at award. Negative if under estimate. */
  budgetVariance?: number;
  overrunReason?: string;
  budgetEscalation?: IBudgetEscalation;
}

export type RfqDocument = HydratedDocument<IRfq>;

const rfqItemSchema = new Schema<IRfqItem>({
  itemCode: String,
  description: { type: String, required: true },
  quantity: { type: Number, required: true, min: 0.0001 },
  uom: { type: String, default: 'EA' },
  specifications: String,
  itemType: { type: String, enum: enumValues(ITEM_TYPE), default: ITEM_TYPE.GOODS },
  sourcePr: { type: Schema.Types.ObjectId, ref: 'PurchaseRequisition', required: true },
  sourcePrItem: { type: Schema.Types.ObjectId, required: true },
});

const rfqSchema = new Schema<IRfq>(
  {
    rfqNumber: { type: String, required: true, unique: true },
    title: { type: String, required: true, trim: true },
    description: String,
    department: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
    requisitions: [{ type: Schema.Types.ObjectId, ref: 'PurchaseRequisition', required: true }],
    items: [rfqItemSchema],
    invitedVendors: [{ type: Schema.Types.ObjectId, ref: 'Vendor' }],
    openAt: { type: Date, required: true },
    closeAt: { type: Date, required: true },
    status: { type: String, enum: enumValues(RFQ_STATUS), default: RFQ_STATUS.DRAFT, index: true },
    awardedBid: { type: Schema.Types.ObjectId, ref: 'Bid' },
    awardJustification: String,
    awardedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    awardedAt: Date,
    purchaseOrder: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    technicalEvaluation: { type: Boolean, default: false },
    financialsOpenedAt: Date,
    financialsOpenedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    requiredLicences: { type: [{ type: String, enum: LICENCE_TYPES }], default: [] },
    isEmergency: { type: Boolean, default: false },
    budgetVariance: Number,
    overrunReason: String,
    budgetEscalation: {
      type: new Schema<IBudgetEscalation>(
        {
          status: { type: String, enum: enumValues(ESCALATION_STATUS), default: ESCALATION_STATUS.PENDING },
          bid: { type: Schema.Types.ObjectId, ref: 'Bid', required: true },
          overrun: { type: Number, required: true },
          shortfall: { type: Number, required: true },
          reason: { type: String, required: true },
          requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          requestedAt: { type: Date, default: Date.now },
          decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
          decidedAt: Date,
          remarks: String,
        },
        { _id: false },
      ),
    },
  },
  { timestamps: true },
);

rfqSchema.pre('validate', function () {
  if (this.closeAt <= this.openAt) {
    this.invalidate('closeAt', 'closeAt must be after openAt');
  }
});

export const RFQ = model<IRfq>('RFQ', rfqSchema);
