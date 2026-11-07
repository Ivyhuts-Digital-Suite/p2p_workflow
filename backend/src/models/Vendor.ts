import { HydratedDocument, Schema, Types, model } from 'mongoose';
import { DOCUMENT_STATUS, DocumentStatus, LICENCE_TYPES, LicenceType, VENDOR_STATUS, VendorStatus, enumValues } from '../constants/status';

export interface IBankDetails {
  accountName: string;
  accountNumber: string;
  ifsc: string;
  bankName: string;
}

export interface IVendorDocument {
  _id: Types.ObjectId;
  type: LicenceType;
  number: string;
  issuedBy?: string;
  expiryDate: Date;
  /** Link to the vendor's copy. Files are not stored here. */
  referenceUrl?: string;
  status: DocumentStatus;
  remarks?: string;
  verifiedBy?: Types.ObjectId;
  verifiedAt?: Date;
  uploadedAt: Date;
}

export interface IVendor {
  vendorCode: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone?: string;
  gstin?: string;
  pan?: string;
  address?: { line1?: string; city?: string; state?: string; pincode?: string };
  categories: string[];
  bankDetails?: IBankDetails;
  /** Default TDS section applied at payment (e.g. 194C, 194J, 194Q) */
  tdsSection: string;
  isMsme: boolean;
  /** 0-5 performance rating, shown to procurement when comparing bids */
  rating: number;
  status: VendorStatus;
  user?: Types.ObjectId;
  documents: IVendorDocument[];
}

export type VendorDocument = HydratedDocument<IVendor>;

const vendorSchema = new Schema<IVendor>(
  {
    vendorCode: { type: String, required: true, unique: true },
    companyName: { type: String, required: true, trim: true },
    contactPerson: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: String,
    gstin: { type: String, uppercase: true, trim: true, sparse: true, unique: true },
    pan: { type: String, uppercase: true, trim: true },
    address: { line1: String, city: String, state: String, pincode: String },
    categories: { type: [String], default: [] },
    bankDetails: {
      accountName: String,
      accountNumber: String,
      ifsc: { type: String, uppercase: true },
      bankName: String,
    },
    tdsSection: { type: String, default: '194C' },
    isMsme: { type: Boolean, default: false },
    rating: { type: Number, min: 0, max: 5, default: 3 },
    status: { type: String, enum: enumValues(VENDOR_STATUS), default: VENDOR_STATUS.PENDING, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    documents: [
      {
        type: { type: String, enum: LICENCE_TYPES, required: true },
        number: { type: String, required: true, trim: true },
        issuedBy: String,
        expiryDate: { type: Date, required: true },
        referenceUrl: String,
        status: { type: String, enum: enumValues(DOCUMENT_STATUS), default: DOCUMENT_STATUS.PENDING },
        remarks: String,
        verifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        verifiedAt: Date,
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

export const Vendor = model<IVendor>('Vendor', vendorSchema);
