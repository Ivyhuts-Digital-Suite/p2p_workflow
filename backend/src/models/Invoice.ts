import { HydratedDocument, Schema, Types, model } from 'mongoose';
import { INVOICE_STATUS, InvoiceStatus, MATCH_STATUS, MatchStatus, enumValues } from '../constants/status';
import { calcOrderTotals, round2 } from '../utils/money';

export interface IInvoiceItem {
  _id: Types.ObjectId;
  poItem: Types.ObjectId;
  /** Product title, shown as "title x quantity". Optional: older lines have none and show the description. */
  title?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  lineTotal: number;
}

export interface IMatchException {
  type:
    | 'VENDOR_MISMATCH'
    | 'ITEM_NOT_ON_PO'
    | 'QTY_EXCEEDS_ORDERED'
    | 'QTY_EXCEEDS_RECEIVED'
    | 'PRICE_VARIANCE'
    | 'TAX_RATE_MISMATCH'
    | 'TOTAL_MISMATCH';
  poItem?: Types.ObjectId;
  message: string;
  expected?: number;
  actual?: number;
}

export interface IInvoiceTax {
  verified: boolean;
  gstinValid: boolean;
  panValid: boolean;
  supplyType: 'INTRA_STATE' | 'INTER_STATE';
  cgst: number;
  sgst: number;
  igst: number;
  tdsSection: string;
  tdsRate: number;
  tdsAmount: number;
  netPayable: number;
  issues: { code: string; message: string; blocking: boolean }[];
  verifiedBy?: Types.ObjectId;
  verifiedAt?: Date;
}

/** Reduces what is paid on the invoice: a debit note we raise, or a credit note the vendor issues. */
export interface IAdjustmentNote {
  _id: Types.ObjectId;
  type: 'DEBIT' | 'CREDIT';
  noteNumber: string;
  /** The vendor's own number, for a credit note */
  vendorReference?: string;
  taxableAmount: number;
  gstAmount: number;
  total: number;
  reason: string;
  returnNote?: Types.ObjectId;
  createdBy: Types.ObjectId;
  createdAt: Date;
}

/** Finance's accepted override of named match exceptions, made by someone other than the invoice's submitter. */
export interface IExceptionDecision {
  exceptionTypes: string[];
  reason: string;
  decidedBy: Types.ObjectId;
  decidedAt: Date;
}

export interface IInvoice {
  /** Vendor's own invoice number (unique per vendor) */
  invoiceNumber: string;
  internalRef: string;
  vendor: Types.ObjectId;
  purchaseOrder: Types.ObjectId;
  invoiceDate: Date;
  dueDate?: Date;
  items: IInvoiceItem[];
  subtotal: number;
  gstAmount: number;
  total: number;
  /** Gross amount printed on the vendor's invoice - compared against computed total */
  claimedTotal: number;
  match: {
    status: MatchStatus;
    exceptions: IMatchException[];
    performedBy?: Types.ObjectId;
    performedAt?: Date;
  };
  liability?: { glAccount: string; bookedBy: Types.ObjectId; bookedAt: Date };
  tax?: IInvoiceTax;
  payment?: Types.ObjectId;
  status: InvoiceStatus;
  rejectionReason?: string;
  submittedBy: Types.ObjectId;
  adjustments: IAdjustmentNote[];
  exceptionDecision?: IExceptionDecision;
}

export type InvoiceDocument = HydratedDocument<IInvoice>;

const invoiceItemSchema = new Schema<IInvoiceItem>({
  poItem: { type: Schema.Types.ObjectId, required: true },
  title: String,
  description: { type: String, required: true },
  quantity: { type: Number, required: true, min: 0.0001 },
  unitPrice: { type: Number, required: true, min: 0 },
  taxRate: { type: Number, required: true, min: 0 },
  lineTotal: { type: Number, default: 0 },
});

const invoiceSchema = new Schema<IInvoice>(
  {
    invoiceNumber: { type: String, required: true, trim: true, uppercase: true },
    internalRef: { type: String, required: true, unique: true },
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    purchaseOrder: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true, index: true },
    invoiceDate: { type: Date, required: true },
    dueDate: Date,
    items: [invoiceItemSchema],
    subtotal: { type: Number, default: 0 },
    gstAmount: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    claimedTotal: { type: Number, required: true, min: 0 },
    match: {
      status: { type: String, enum: enumValues(MATCH_STATUS), default: MATCH_STATUS.PENDING },
      exceptions: [
        {
          _id: false,
          type: { type: String, required: true },
          poItem: Schema.Types.ObjectId,
          message: { type: String, required: true },
          expected: Number,
          actual: Number,
        },
      ],
      performedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      performedAt: Date,
    },
    liability: {
      glAccount: String,
      bookedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      bookedAt: Date,
    },
    tax: {
      verified: Boolean,
      gstinValid: Boolean,
      panValid: Boolean,
      supplyType: { type: String, enum: ['INTRA_STATE', 'INTER_STATE'] },
      cgst: Number,
      sgst: Number,
      igst: Number,
      tdsSection: String,
      tdsRate: Number,
      tdsAmount: Number,
      netPayable: Number,
      issues: [{ _id: false, code: String, message: String, blocking: Boolean }],
      verifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      verifiedAt: Date,
    },
    payment: { type: Schema.Types.ObjectId, ref: 'Payment' },
    status: { type: String, enum: enumValues(INVOICE_STATUS), default: INVOICE_STATUS.SUBMITTED, index: true },
    rejectionReason: String,
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    adjustments: [
      {
        type: { type: String, enum: ['DEBIT', 'CREDIT'], required: true },
        noteNumber: { type: String, required: true },
        vendorReference: String,
        taxableAmount: { type: Number, required: true, min: 0 },
        gstAmount: { type: Number, default: 0, min: 0 },
        total: { type: Number, required: true, min: 0 },
        reason: { type: String, required: true },
        returnNote: { type: Schema.Types.ObjectId, ref: 'ReturnNote' },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    exceptionDecision: {
      exceptionTypes: { type: [String], default: undefined },
      reason: String,
      decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      decidedAt: Date,
    },
  },
  { timestamps: true },
);

// Duplicate-invoice control: a vendor cannot submit the same invoice number twice.
invoiceSchema.index({ vendor: 1, invoiceNumber: 1 }, { unique: true });

invoiceSchema.pre('validate', function () {
  for (const item of this.items) {
    item.lineTotal = round2(item.quantity * item.unitPrice);
  }
  const totals = calcOrderTotals(this.items);
  this.subtotal = totals.subtotal;
  this.gstAmount = totals.taxTotal;
  this.total = totals.grandTotal;
});

export const Invoice = model<IInvoice>('Invoice', invoiceSchema);
