import { z } from 'zod';
import { LICENCE_TYPES } from '../../constants/status';
import { GSTIN_REGEX, PAN_REGEX, TDS_SECTIONS } from '../../services/tax.service';

const bankDetails = z.object({
  accountName: z.string().min(2),
  accountNumber: z.string().regex(/^\d{9,18}$/, 'Account number must be 9-18 digits'),
  ifsc: z.string().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC'),
  bankName: z.string().min(2),
});

const vendorProfile = {
  companyName: z.string().min(2),
  contactPerson: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
  gstin: z.string().toUpperCase().regex(GSTIN_REGEX, 'Invalid GSTIN').optional(),
  pan: z.string().toUpperCase().regex(PAN_REGEX, 'Invalid PAN').optional(),
  address: z
    .object({ line1: z.string().optional(), city: z.string().optional(), state: z.string().optional(), pincode: z.string().optional() })
    .optional(),
  categories: z.array(z.string()).optional(),
  bankDetails: bankDetails.optional(),
  isMsme: z.boolean().optional(),
};

export const createVendorSchema = z.object({
  ...vendorProfile,
  tdsSection: z.enum(Object.keys(TDS_SECTIONS) as [string, ...string[]]).default('194C'),
  /** Optional: create a portal login for the vendor at the same time */
  portalPassword: z.string().min(8).optional(),
});

export const updateVendorSchema = z.object({
  ...vendorProfile,
  tdsSection: z.enum(Object.keys(TDS_SECTIONS) as [string, ...string[]]).optional(),
  rating: z.number().min(0).max(5).optional(),
}).partial();

/** Fields a vendor may edit on their own profile */
export const vendorSelfUpdateSchema = z
  .object({
    contactPerson: vendorProfile.contactPerson,
    phone: vendorProfile.phone,
    address: vendorProfile.address,
    categories: vendorProfile.categories,
    bankDetails: bankDetails,
  })
  .partial();

export const statusReasonSchema = z.object({ reason: z.string().min(3) });

export const vendorDocumentSchema = z.object({
  type: z.enum(LICENCE_TYPES),
  number: z.string().trim().min(2, 'Enter the licence number'),
  issuedBy: z.string().trim().optional(),
  expiryDate: z.coerce.date().refine((d) => d > new Date(), 'This document has already expired'),
  referenceUrl: z.string().trim().url('Enter a full link, starting with https://').optional(),
});

export const verifyDocumentSchema = z
  .object({ decision: z.enum(['VERIFIED', 'REJECTED']), remarks: z.string().trim().optional() })
  .refine((d) => d.decision === 'VERIFIED' || (d.remarks?.length ?? 0) >= 3, { message: 'Give the reason for rejecting this document', path: ['remarks'] });
