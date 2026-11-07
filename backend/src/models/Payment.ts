import { HydratedDocument, Schema, Types, model } from 'mongoose';
import { APPROVAL_STATUS, ApprovalStatus, PAYMENT_MODE, PAYMENT_STATUS, PaymentMode, PaymentStatus, enumValues } from '../constants/status';
import { Role } from '../constants/roles';
import { IBankDetails } from './Vendor';

export interface IPaymentApproval {
  level: number;
  role: Role;
  status: ApprovalStatus;
  actedBy?: Types.ObjectId;
  actedAt?: Date;
  remarks?: string;
}

export interface IPayment {
  paymentRef: string;
  invoice: Types.ObjectId;
  vendor: Types.ObjectId;
  /** The ordering department, for an HOD step in the approval chain */
  department?: Types.ObjectId;
  grossAmount: number;
  tdsAmount: number;
  netAmount: number;
  /** Debit and credit notes taken off the gross amount */
  adjustmentTotal: number;
  mode?: PaymentMode;
  /** Snapshot of the beneficiary account at verification time */
  beneficiary?: IBankDetails;
  /** Bank Unique Transaction Reference, once the transfer succeeds */
  utr?: string;
  status: PaymentStatus;
  failureReason?: string;
  /** Approval chain from a PAYMENT DoA rule; empty when no rule covers this amount */
  approvals: IPaymentApproval[];
  /** Sent to the bank. New per attempt, so a retry is never mistaken for a repeat of the failed attempt. */
  bankReference?: string;
  attempts: number;
  /** True when no real bank was involved */
  simulated: boolean;
  /** Finance user who verified tax compliance */
  verifiedBy: Types.ObjectId;
  /** Who released the funds */
  releasedBy?: Types.ObjectId;
  /** Kept when the account behind releasedBy was removed, so the record still says who it was */
  releasedByName?: string;
  releasedAt?: Date;
}

export type PaymentDocument = HydratedDocument<IPayment>;

const paymentSchema = new Schema<IPayment>(
  {
    paymentRef: { type: String, required: true, unique: true },
    invoice: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true, unique: true },
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    department: { type: Schema.Types.ObjectId, ref: 'Department' },
    grossAmount: { type: Number, required: true },
    tdsAmount: { type: Number, default: 0 },
    netAmount: { type: Number, required: true },
    adjustmentTotal: { type: Number, default: 0 },
    mode: { type: String, enum: enumValues(PAYMENT_MODE) },
    beneficiary: { accountName: String, accountNumber: String, ifsc: String, bankName: String },
    utr: String,
    status: { type: String, enum: enumValues(PAYMENT_STATUS), default: PAYMENT_STATUS.PENDING_RELEASE, index: true },
    failureReason: String,
    approvals: [
      {
        _id: false,
        level: { type: Number, required: true },
        role: { type: String, required: true },
        status: { type: String, enum: enumValues(APPROVAL_STATUS), default: APPROVAL_STATUS.PENDING },
        actedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        actedAt: Date,
        remarks: String,
      },
    ],
    bankReference: { type: String, index: true, sparse: true },
    attempts: { type: Number, default: 0 },
    simulated: { type: Boolean, default: false },
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    releasedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    releasedByName: String,
    releasedAt: Date,
  },
  { timestamps: true, optimisticConcurrency: true },
);

export const Payment = model<IPayment>('Payment', paymentSchema);
