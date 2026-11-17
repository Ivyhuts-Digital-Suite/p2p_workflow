export type Role = 'REQUESTER' | 'HOD' | 'PROCUREMENT' | 'STORE' | 'FINANCE' | 'AUDITOR' | 'VENDOR' | 'ADMIN';

export interface Ref {
  _id: string;
  name?: string;
  code?: string;
  companyName?: string;
  vendorCode?: string;
  contactPerson?: string;
}

/** Who a document is waiting on */
export interface PendingAt {
  role: Role;
  department?: string;
  userName?: string;
  label: string;
}

export type ItemType =
  | 'GOODS'
  | 'BATCH'
  | 'SERIAL'
  | 'EQUIPMENT'
  | 'SERVICE'
  | 'SURGICAL_INSTRUMENT'
  | 'CAPITAL_EQUIPMENT'
  | 'LAB_REAGENT'
  | 'IT_ELECTRONICS'
  | 'MAINTENANCE';

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  GOODS: 'General goods',
  BATCH: 'Drug / consumable (batch & expiry)',
  SERIAL: 'Device (serial numbers)',
  EQUIPMENT: 'Equipment (serials & commissioning)',
  SERVICE: 'Service',
  SURGICAL_INSTRUMENT: 'Surgical Instruments',
  CAPITAL_EQUIPMENT: 'Capital Equipment / Medical Assets',
  LAB_REAGENT: 'Laboratory Reagents & Lab Supplies',
  IT_ELECTRONICS: 'IT & Electronics',
  MAINTENANCE: 'Maintenance & Facility Items',
};

/** How each type is received, matching the server. Other types are received as general goods. */
export const BATCH_TRACKED: string[] = ['BATCH', 'LAB_REAGENT'];
export const SERIAL_TRACKED: string[] = ['SERIAL', 'EQUIPMENT', 'CAPITAL_EQUIPMENT'];
export const NEEDS_COMMISSIONING: string[] = ['EQUIPMENT', 'CAPITAL_EQUIPMENT'];

export interface CatalogItem {
  description: string;
  itemCode?: string;
  uom: string;
  estimatedUnitPrice?: number;
}

/** The signed-in user's unread messages, for the badge on each journey card: by PR, and by RFQ for vendor conversations */
export interface ChatUnread {
  prs: Record<string, number>;
  rfqs: Record<string, number>;
}

/** One vendor's conversation on an RFQ, as Procurement lists them */
export interface VendorThread {
  vendorId: string;
  companyName: string;
  unread: number;
  lastMessageAt?: string;
}

export interface PrMessage {
  _id: string;
  sender: string;
  senderName: string;
  senderRole: string;
  text: string;
  createdAt: string;
  readBy: { user: string; name: string; at: string }[];
}


export const LICENCE_LABELS: Record<string, string> = {
  DRUG_LICENCE: 'Drug licence',
  MEDICAL_DEVICE_LICENCE: 'Medical device licence',
  BIOMEDICAL_WASTE_AUTHORISATION: 'Biomedical waste authorisation',
  ISO_CERTIFICATE: 'ISO certificate',
  OTHER: 'Other',
};

export interface Approval {
  level: number;
  role: Role;
  status: string;
  remarks?: string;
}

export interface JourneyStep {
  group?: string;
  label: string;
  /** What has happened, or what it is waiting for, in plain words */
  status: string;
  state: 'done' | 'current' | 'blocked' | 'locked';
  detail?: string;
}

export interface JourneyTrack {
  id: string;
  reference: string;
  title: string;
  description?: string;
  steps: JourneyStep[];
  pendingAt?: PendingAt;
  message: string;
  yourAction: boolean;
  prId?: string;
  /** The RFQ behind the track, for vendor conversations */
  rfqId?: string;
}

export interface User {
  _id: string;
  name: string;
  email: string;
  role: Role;
  department?: Ref;
  vendor?: Ref & { status?: string };
  doaLimit: number;
  isActive: boolean;
  lastLoginAt?: string;
}

export interface VendorRegistration {
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  password: string;
  gstin: string;
  pan: string;
  categories: string[];
}

export interface InternalRegistration {
  role: Role;
  name: string;
  email: string;
  password: string;
  department?: string;
  registrationCode?: string;
}

export interface SignupOptions {
  claimedRoles: Role[];
  departments: { _id: string; name: string; code: string; hodClaimed: boolean }[];
  internalSignupEnabled: boolean;
  registrationCodeRequired: boolean;
}

export interface Department {
  _id: string;
  name: string;
  code: string;
  costCenter?: string;
  hod?: { _id: string; name: string; email: string };
  budget: { fiscalYear: string; allocated: number; committed: number; consumed: number };
  isActive: boolean;
}

export type DoaDocumentType = 'PO' | 'PR' | 'PAYMENT';

export interface DoaRule {
  _id: string;
  name: string;
  documentType?: DoaDocumentType;
  minAmount: number;
  maxAmount: number | null;
  levels: { level: number; role: Role }[];
  isActive: boolean;
}

export interface AuditLogEntry {
  _id: string;
  at: string;
  actorEmail?: string;
  actorRole?: string;
  module: string;
  action: string;
  docRef?: string;
  statusCode: number;
  success: boolean;
  remarks?: string;
}

export interface AwardRecord {
  _id: string;
  rfqNumber: string;
  title: string;
  awardJustification?: string;
  awardedAt?: string;
  awardedBy?: { name: string; role: Role };
  awardedBid?: { totalAmount: number; rank?: number; vendor: Ref };
}

export interface ComplianceReport {
  invoices: Invoice[];
  payments: (Payment & { releasedBy?: { _id: string; name: string } })[];
  vendors: Vendor[];
}

export interface BankDetails {
  accountName: string;
  accountNumber: string;
  ifsc: string;
  bankName: string;
}

export interface PrItem {
  _id?: string;
  itemCode?: string;
  /** Product title; older lines have none and fall back to the description */
  title?: string;
  description: string;
  category?: string;
  quantity: number;
  uom: string;
  estimatedUnitPrice: number;
  estimatedTotal?: number;
  itemType?: ItemType;
}

export interface Requisition {
  _id: string;
  prNumber: string;
  title: string;
  justification?: string;
  department: Ref;
  requester: Ref & { email?: string };
  items: PrItem[];
  totalEstimate: number;
  priority: string;
  status: string;
  isActive: boolean;
  neededBy?: string;
  createdAt: string;
  approvals: Approval[];
  pendingAt?: PendingAt;
  isEmergency?: boolean;
  emergencyReason?: string;
  ratification?: { status?: string; remarks?: string };
  /** The RFQ raised for this PR, once there is one */
  rfq?: string;
}

export interface Vendor {
  _id: string;
  vendorCode: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone?: string;
  gstin?: string;
  pan?: string;
  categories: string[];
  bankDetails?: BankDetails;
  rating: number;
  status: string;
  tdsSection: string;
  documents?: VendorDocument[];
}

export interface VendorDocument {
  _id: string;
  type: string;
  number: string;
  issuedBy?: string;
  expiryDate: string;
  referenceUrl?: string;
  status: string;
  remarks?: string;
}

export interface RfqItem {
  _id: string;
  title?: string;
  description: string;
  quantity: number;
  uom: string;
  specifications?: string;
  itemType?: ItemType;
}

export interface Rfq {
  _id: string;
  rfqNumber: string;
  title: string;
  description?: string;
  items: RfqItem[];
  openAt: string;
  closeAt: string;
  status: string;
  awardedBid?: { _id: string; vendor?: Ref; totalAmount?: number; taxAmount?: number; grandTotal?: number; rank?: number };
  awardedAt?: string;
  department?: Ref;
  technicalEvaluation?: boolean;
  financialsOpenedAt?: string;
  requiredLicences?: string[];
  isEmergency?: boolean;
  budgetEstimate?: number;
  budgetEscalation?: { status: string; shortfall: number; overrun: number; reason: string; remarks?: string };
  purchaseOrder?: { _id: string; poNumber: string; status: string };
  /** Internal: not sent to vendors */
  requisitions?: string[];
}

export interface Bid {
  _id: string;
  rfq: string;
  vendor: Ref & { rating?: number };
  items: { rfqItem: string; quantity: number; unitPrice: number; taxRate?: number; lineTotal: number; title?: string; description?: string; uom?: string }[];
  totalAmount: number;
  taxAmount?: number;
  grandTotal?: number;
  deliveryDays: number;
  /** A two-envelope tender whose prices have not been opened */
  pricesSealed?: boolean;
  technicalStatus?: string;
  technicalRemarks?: string;
  qualityScore?: number;
  priceScore?: number;
  rank?: number;
  revision: number;
  status: string;
  submittedAt: string;
}

export interface DashboardRow {
  rfqId: string;
  rfqNumber: string;
  title: string;
  status: string;
  isLive: boolean;
  closeAt: string;
  timeRemainingMs: number;
  totalBids: number;
  pricesSealed?: boolean;
  items?: string[];
  lowestBid: number | null;
  rankings: { rank: number; companyName: string; totalAmount: number }[];
  topVendor: null | {
    companyName: string;
    vendorCode: string;
    totalAmount: number;
    rank?: number;
    awarded: boolean;
  };
}

export interface PoItem {
  _id: string;
  /** Product title; older lines have none and fall back to the description */
  title?: string;
  description: string;
  quantity: number;
  uom: string;
  unitPrice: number;
  taxRate: number;
  lineTotal: number;
  itemType?: ItemType;
  receivedQty: number;
  invoicedQty: number;
  commissionedQty?: number;
  /** How much the Store or a sign-off has cleared for billing; only on the invoiceable list */
  clearedQty?: number;
}

export interface PurchaseOrder {
  _id: string;
  poNumber: string;
  vendor: Ref;
  department: Ref;
  /** The RFQ title is the PO's title */
  rfq?: { _id: string; rfqNumber: string; title?: string };
  items: PoItem[];
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  approvals: Approval[];
  status: string;
  isEmergency?: boolean;
  createdBy?: string;
  shortClose?: { reason?: string; at?: string; releasedBudget?: number };
  pendingAt?: PendingAt;
  createdAt: string;
  updatedAt: string;
  /** Total of booked and paid invoices */
  invoicedAmount: number;
  paidAmount: number;
}

export interface PoSummary {
  active: number;
  past: number;
  pendingMyApproval: number;
}

export interface GoodsReceipt {
  _id: string;
  grnNumber: string;
  purchaseOrder: { _id: string; poNumber: string };
  vendor: Ref;
  warehouse: string;
  deliveryNoteNumber?: string;
  physicalCheck?: { boxesExpected: number; boxesCounted: number };
  qcRemarks?: string;
  status: string;
  items: {
    _id: string;
    title?: string;
    description: string;
    orderedQty: number;
    receivedQty: number;
    acceptedQty: number;
    rejectedQty: number;
    rejectionReason?: string;
    qualityStatus?: string;
    shortageQty?: number;
    shortageReason?: string;
    batchNumber?: string;
    expiryDate?: string;
    serialNumbers?: string[];
    qcReleasedQty?: number;
    qcRejectedQty?: number;
    returnedQty?: number;
  }[];
  receivedAt: string;
}

export interface ReturnNote {
  _id: string;
  returnNumber: string;
  grn: { _id: string; grnNumber: string };
  purchaseOrder: { _id: string; poNumber: string };
  vendor: Ref;
  description: string;
  quantity: number;
  reason: string;
  resolution: 'REPLACE' | 'CREDIT';
  status: string;
  carrierReference?: string;
  createdAt: string;
}

export interface NearExpiryRow {
  description: string;
  warehouse: string;
  uom: string;
  batchNumber?: string;
  expiryDate: string;
  quantity: number;
  daysLeft: number;
  expired: boolean;
}

export interface ServiceEntry {
  _id: string;
  entryNumber: string;
  type: 'SERVICE' | 'COMMISSIONING';
  purchaseOrder: { _id: string; poNumber: string };
  vendor: Ref;
  description: string;
  quantity: number;
  completedOn: string;
  remarks?: string;
  status: string;
  raisedBy?: { _id: string; name: string };
  decidedBy?: { name: string };
  decisionRemarks?: string;
}

export interface InventoryItem {
  _id: string;
  itemKey: string;
  description: string;
  warehouse: string;
  uom: string;
  quantity: number;
  batches?: { batchNumber?: string; expiryDate?: string; quantity: number }[];
}

export interface MatchException {
  type: string;
  message: string;
  expected?: number;
  actual?: number;
}

export interface Invoice {
  _id: string;
  invoiceNumber: string;
  internalRef: string;
  vendor: Ref & { gstin?: string; pan?: string; tdsSection?: string };
  purchaseOrder: { _id: string; poNumber: string };
  invoiceDate: string;
  dueDate?: string;
  items: { title?: string; description: string; quantity: number; unitPrice: number; taxRate: number }[];
  adjustments?: { _id: string; type: 'DEBIT' | 'CREDIT'; noteNumber: string; vendorReference?: string; taxableAmount: number; gstAmount: number; total: number; reason: string }[];
  exceptionDecision?: { exceptionTypes?: string[]; reason?: string };
  pendingAt?: PendingAt;
  submittedBy?: string;
  subtotal: number;
  gstAmount: number;
  total: number;
  claimedTotal: number;
  match: { status: string; exceptions: MatchException[]; performedBy?: { name: string; role: Role }; performedAt?: string };
  tax?: {
    verified: boolean;
    gstinValid?: boolean;
    panValid?: boolean;
    verifiedBy?: { name: string; role: Role };
    verifiedAt?: string;
    tdsSection: string;
    tdsRate: number;
    tdsAmount: number;
    netPayable: number;
    issues: { code: string; message: string; blocking: boolean }[];
  };
  status: string;
}

export interface Payment {
  _id: string;
  paymentRef: string;
  vendor: Ref;
  invoice: { _id: string; invoiceNumber: string; internalRef: string; dueDate?: string; subtotal?: number; gstAmount?: number; total?: number; items?: { description: string }[] };
  grossAmount: number;
  tdsAmount: number;
  netAmount: number;
  adjustmentTotal?: number;
  mode?: string;
  utr?: string;
  status: string;
  failureReason?: string;
  simulated?: boolean;
  approvals?: Approval[];
  attempts?: number;
  pendingAt?: PendingAt;
  verifiedBy?: { _id: string; name: string };
  releasedByName?: string;
  releasedAt?: string;
}

export interface BudgetCheck {
  code: 'BUDGET_OVERRUN' | 'BUDGET_EXCEEDED';
  estimate: number;
  quote: number;
  overrun: number;
  available: number;
  shortfall: number;
  department: string;
  escalation?: string;
}
