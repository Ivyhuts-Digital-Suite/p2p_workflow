export const enumValues = <T extends Record<string, string>>(obj: T) => Object.values(obj) as T[keyof T][];

export const PR_STATUS = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SOURCING: 'SOURCING',
  PO_CREATED: 'PO_CREATED',
  CANCELLED: 'CANCELLED',
} as const;
export type PrStatus = (typeof PR_STATUS)[keyof typeof PR_STATUS];

export const PR_PRIORITY = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' } as const;

export const RFQ_STATUS = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  CLOSED: 'CLOSED',
  AWARDED: 'AWARDED',
  CANCELLED: 'CANCELLED',
} as const;
export type RfqStatus = (typeof RFQ_STATUS)[keyof typeof RFQ_STATUS];

export const BID_STATUS = {
  SUBMITTED: 'SUBMITTED',
  WITHDRAWN: 'WITHDRAWN',
  AWARDED: 'AWARDED',
  REJECTED: 'REJECTED',
} as const;
export type BidStatus = (typeof BID_STATUS)[keyof typeof BID_STATUS];

export const PO_STATUS = {
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  ISSUED: 'ISSUED',
  /** Legacy: vendors once acknowledged POs. Kept so older POs still read correctly. */
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  PARTIALLY_RECEIVED: 'PARTIALLY_RECEIVED',
  RECEIVED: 'RECEIVED',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
  SHORT_CLOSED: 'SHORT_CLOSED',
} as const;
export type PoStatus = (typeof PO_STATUS)[keyof typeof PO_STATUS];

/** Finished POs: the history view. Everything else is active. */
export const PO_PAST_STATUSES: PoStatus[] = [PO_STATUS.CLOSED, PO_STATUS.CANCELLED, PO_STATUS.REJECTED, PO_STATUS.SHORT_CLOSED];
/** POs Finance can record an invoice against. */
export const PO_INVOICEABLE_STATUSES: PoStatus[] = [
  PO_STATUS.ISSUED,
  PO_STATUS.ACKNOWLEDGED,
  PO_STATUS.PARTIALLY_RECEIVED,
  PO_STATUS.RECEIVED,
];
/** POs a vendor can invoice: from the moment the PO is issued to them. ACKNOWLEDGED is kept for older POs. */
export const PO_VENDOR_INVOICEABLE_STATUSES: PoStatus[] = [
  PO_STATUS.ISSUED,
  PO_STATUS.ACKNOWLEDGED,
  PO_STATUS.PARTIALLY_RECEIVED,
  PO_STATUS.RECEIVED,
];

export const APPROVAL_STATUS = { PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED' } as const;
export type ApprovalStatus = (typeof APPROVAL_STATUS)[keyof typeof APPROVAL_STATUS];

export const GRN_STATUS = {
  ACCEPTED: 'ACCEPTED',
  PARTIALLY_ACCEPTED: 'PARTIALLY_ACCEPTED',
  REJECTED: 'REJECTED',
} as const;
export type GrnStatus = (typeof GRN_STATUS)[keyof typeof GRN_STATUS];

export const GRN_QUALITY_STATUS = { PASSED: 'PASSED', DAMAGED: 'DAMAGED', QUALITY_FAILED: 'QUALITY_FAILED' } as const;
export type GrnQualityStatus = (typeof GRN_QUALITY_STATUS)[keyof typeof GRN_QUALITY_STATUS];

export const INVOICE_STATUS = {
  SUBMITTED: 'SUBMITTED',
  MATCHED: 'MATCHED',
  EXCEPTION: 'EXCEPTION',
  BOOKED: 'BOOKED',
  TAX_VERIFIED: 'TAX_VERIFIED',
  PAID: 'PAID',
  REJECTED: 'REJECTED',
} as const;
export type InvoiceStatus = (typeof INVOICE_STATUS)[keyof typeof INVOICE_STATUS];

export const MATCH_STATUS = { PENDING: 'PENDING', MATCHED: 'MATCHED', EXCEPTION: 'EXCEPTION' } as const;
export type MatchStatus = (typeof MATCH_STATUS)[keyof typeof MATCH_STATUS];

export const PAYMENT_STATUS = {
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  PENDING_RELEASE: 'PENDING_RELEASE',
  /** Sent to the bank; the outcome arrives by webhook or a status check */
  PROCESSING: 'PROCESSING',
  RELEASED: 'RELEASED',
  FAILED: 'FAILED',
} as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

export const PAYMENT_MODE = { NEFT: 'NEFT', RTGS: 'RTGS', IMPS: 'IMPS' } as const;
export type PaymentMode = (typeof PAYMENT_MODE)[keyof typeof PAYMENT_MODE];

export const VENDOR_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  SUSPENDED: 'SUSPENDED',
  BLACKLISTED: 'BLACKLISTED',
} as const;
export type VendorStatus = (typeof VENDOR_STATUS)[keyof typeof VENDOR_STATUS];

/** Valid GST slab rates (%) */
export const GST_SLABS = [0, 5, 12, 18, 28];

/** What a PR line is, which decides how it is received. Set on the PR and carried through the RFQ to the PO. */
export const ITEM_TYPE = {
  GOODS: 'GOODS',
  /** Drugs and consumables: batch number and expiry date are mandatory at receipt */
  BATCH: 'BATCH',
  /** Devices: one serial number per unit */
  SERIAL: 'SERIAL',
  /** Serialised, and also needs a commissioning sign-off before it can be billed */
  EQUIPMENT: 'EQUIPMENT',
  /** Not received at the dock: signed off by the department instead */
  SERVICE: 'SERVICE',
  SURGICAL_INSTRUMENT: 'SURGICAL_INSTRUMENT',
  /** Received like equipment: serials, then a commissioning sign-off before billing */
  CAPITAL_EQUIPMENT: 'CAPITAL_EQUIPMENT',
  /** Received like drugs: batch number and expiry date */
  LAB_REAGENT: 'LAB_REAGENT',
  IT_ELECTRONICS: 'IT_ELECTRONICS',
  MAINTENANCE: 'MAINTENANCE',
} as const;
export type ItemType = (typeof ITEM_TYPE)[keyof typeof ITEM_TYPE];

/** How each type is received. Types not listed here are received as general goods. */
export const BATCH_TRACKED: string[] = [ITEM_TYPE.BATCH, ITEM_TYPE.LAB_REAGENT];
export const SERIAL_TRACKED: string[] = [ITEM_TYPE.SERIAL, ITEM_TYPE.EQUIPMENT, ITEM_TYPE.CAPITAL_EQUIPMENT];
export const NEEDS_COMMISSIONING: string[] = [ITEM_TYPE.EQUIPMENT, ITEM_TYPE.CAPITAL_EQUIPMENT];

export const QC_STATUS = { PENDING: 'PENDING', RELEASED: 'RELEASED', PARTIALLY_RELEASED: 'PARTIALLY_RELEASED', REJECTED: 'REJECTED' } as const;
export type QcStatus = (typeof QC_STATUS)[keyof typeof QC_STATUS];

export const TECHNICAL_STATUS = { PENDING: 'PENDING', QUALIFIED: 'QUALIFIED', DISQUALIFIED: 'DISQUALIFIED' } as const;
export type TechnicalStatus = (typeof TECHNICAL_STATUS)[keyof typeof TECHNICAL_STATUS];

export const LICENCE_TYPES = ['DRUG_LICENCE', 'MEDICAL_DEVICE_LICENCE', 'BIOMEDICAL_WASTE_AUTHORISATION', 'ISO_CERTIFICATE', 'OTHER'] as const;
export type LicenceType = (typeof LICENCE_TYPES)[number];

export const DOCUMENT_STATUS = { PENDING: 'PENDING', VERIFIED: 'VERIFIED', REJECTED: 'REJECTED' } as const;
export type DocumentStatus = (typeof DOCUMENT_STATUS)[keyof typeof DOCUMENT_STATUS];

export const RETURN_STATUS = { RAISED: 'RAISED', DISPATCHED: 'DISPATCHED' } as const;
export type ReturnStatus = (typeof RETURN_STATUS)[keyof typeof RETURN_STATUS];

export const SERVICE_ENTRY_STATUS = { PENDING: 'PENDING', ACCEPTED: 'ACCEPTED', REJECTED: 'REJECTED' } as const;
export type ServiceEntryStatus = (typeof SERVICE_ENTRY_STATUS)[keyof typeof SERVICE_ENTRY_STATUS];

export const ESCALATION_STATUS = { PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED' } as const;
export type EscalationStatus = (typeof ESCALATION_STATUS)[keyof typeof ESCALATION_STATUS];

export const RATIFICATION_STATUS = { PENDING: 'PENDING', RATIFIED: 'RATIFIED', REJECTED: 'REJECTED' } as const;
export type RatificationStatus = (typeof RATIFICATION_STATUS)[keyof typeof RATIFICATION_STATUS];

/**
 * Match exceptions Finance may accept with a written reason. The quantity, vendor and line
 * exceptions are never overridable: that would mean paying for goods that were not received or ordered.
 */
export const OVERRIDABLE_EXCEPTIONS = ['PRICE_VARIANCE', 'TAX_RATE_MISMATCH', 'TOTAL_MISMATCH'];
