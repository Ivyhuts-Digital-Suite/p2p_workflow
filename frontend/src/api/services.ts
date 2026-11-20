import type {
  ChatUnread,
  VendorThread,
  AuditLogEntry,
  AwardRecord,
  BankDetails,
  Bid,
  CatalogItem,
  ComplianceReport,
  DashboardRow,
  Department,
  DoaRule,
  GoodsReceipt,
  InternalRegistration,
  InventoryItem,
  Invoice,
  JourneyTrack,
  NearExpiryRow,
  PendingAt,
  Payment,
  PoSummary,
  PrMessage,
  PrItem,
  PurchaseOrder,
  Requisition,
  ReturnNote,
  Rfq,
  Role,
  ServiceEntry,
  SignupOptions,
  User,
  Vendor,
  VendorRegistration,
} from '../types';
import { api } from './client';

const data = <T>(p: Promise<{ data: T }>) => p.then((r) => r.data);

export const authApi = {
  login: (email: string, password: string, roles?: Role[]) =>
    data<{ token: string; user: User }>(api.post('/auth/login', { email, password, roles })),
  me: () => data<User>(api.get('/auth/me')),
  signupOptions: () => data<SignupOptions>(api.get('/auth/signup-options')),
  registerVendor: (body: VendorRegistration) =>
    data<{ token: string; user: User; message: string }>(api.post('/auth/register-vendor', body)),
  registerInternal: (body: InternalRegistration) =>
    data<{ message: string; token?: string; user?: User }>(api.post('/auth/register-internal', body)),
};

export const adminApi = {
  users: () => data<User[]>(api.get('/admin/users')),
  createUser: (body: { name: string; email: string; password: string; role: Role; department?: string; doaLimit: number }) =>
    data<User>(api.post('/admin/users', body)),
  updateUser: (id: string, body: Partial<{ role: Role; department: string | null; doaLimit: number; isActive: boolean }>) =>
    data<User>(api.patch(`/admin/users/${id}`, body)),
  departments: () => data<Department[]>(api.get('/admin/departments')),
  createDepartment: (body: { name: string; code: string; costCenter?: string; budget: { fiscalYear: string; allocated: number } }) =>
    data<Department>(api.post('/admin/departments', body)),
  updateDepartment: (id: string, body: { budget?: { allocated?: number } }) =>
    data<Department>(api.patch(`/admin/departments/${id}`, body)),
  doaRules: () => data<DoaRule[]>(api.get('/admin/doa-rules')),
  createDoaRule: (body: Omit<DoaRule, '_id'>) => data<DoaRule>(api.post('/admin/doa-rules', body)),
  updateDoaRule: (id: string, body: Partial<Omit<DoaRule, '_id'>>) => data<DoaRule>(api.patch(`/admin/doa-rules/${id}`, body)),
};

export const auditApi = {
  activity: (params?: Record<string, string>) => data<AuditLogEntry[]>(api.get('/audit/activity', { params })),
  matching: () => data<Invoice[]>(api.get('/audit/matching')),
  compliance: () => data<ComplianceReport>(api.get('/audit/compliance')),
  awards: () => data<AwardRecord[]>(api.get('/audit/awards')),
};

export const requisitionApi = {
  list: (params?: Record<string, string>) => data<Requisition[]>(api.get('/requisitions', { params })),
  create: (body: { title: string; department: string; justification?: string; priority: string; items: PrItem[]; isEmergency?: boolean; emergencyReason?: string }) =>
    data<Requisition>(api.post('/requisitions', body)),
  submit: (id: string) => data<Requisition>(api.post(`/requisitions/${id}/submit`)),
  approve: (id: string, remarks?: string) => data<Requisition>(api.post(`/requisitions/${id}/approve`, { remarks })),
  reject: (id: string, remarks: string) => data<Requisition>(api.post(`/requisitions/${id}/reject`, { remarks })),
  cancel: (id: string, reason: string) => data<Requisition>(api.post(`/requisitions/${id}/cancel`, { reason })),
  update: (id: string, body: { title: string; department: string; justification?: string; priority: string; items: PrItem[]; isEmergency?: boolean; emergencyReason?: string }) =>
    data<Requisition>(api.patch(`/requisitions/${id}`, body)),
  journey: (id: string) => data<JourneyTrack>(api.get(`/requisitions/${id}/journey`)),
  messages: (id: string) => data<PrMessage[]>(api.get(`/requisitions/${id}/messages`)),
  sendMessage: (id: string, text: string) => data<PrMessage>(api.post(`/requisitions/${id}/messages`, { text })),
  ratify: (id: string, decision: 'RATIFY' | 'REJECT', remarks?: string) => data<Requisition>(api.post(`/requisitions/${id}/ratify`, { decision, remarks })),
};

export const vendorApi = {
  list: (params?: Record<string, string>) => data<Vendor[]>(api.get('/vendors', { params })),
  approve: (id: string) => data<Vendor>(api.post(`/vendors/${id}/approve`)),
  suspend: (id: string) => data<Vendor>(api.post(`/vendors/${id}/suspend`)),
  blacklist: (id: string) => data<Vendor>(api.post(`/vendors/${id}/blacklist`)),
  me: () => data<Vendor>(api.get('/vendors/me')),
  updateMe: (body: { contactPerson?: string; phone?: string; bankDetails?: BankDetails }) =>
    data<Vendor>(api.patch('/vendors/me', body)),
  addDocument: (body: { type: string; number: string; issuedBy?: string; expiryDate: string; referenceUrl?: string }) =>
    data<Vendor>(api.post('/vendors/me/documents', body)),
  verifyDocument: (vendorId: string, documentId: string, decision: 'VERIFIED' | 'REJECTED', remarks?: string) =>
    data<Vendor>(api.post(`/vendors/${vendorId}/documents/${documentId}/verify`, { decision, remarks })),
};

export const sourcingApi = {
  dashboard: () => data<{ summary: Record<string, number>; rfqs: DashboardRow[] }>(api.get('/sourcing/dashboard')),
  listRfqs: () => data<Rfq[]>(api.get('/sourcing/rfqs')),
  createRfq: (body: {
    title: string;
    requisitionIds: string[];
    invitedVendorIds: string[];
    closeAt: string;
    requiredLicences?: string[];
  }) => data<Rfq>(api.post('/sourcing/rfqs', body)),
  publish: (id: string) => data<Rfq>(api.post(`/sourcing/rfqs/${id}/publish`)),
  close: (id: string) => data<Rfq>(api.post(`/sourcing/rfqs/${id}/close`)),
  cancel: (id: string) => data<Rfq>(api.post(`/sourcing/rfqs/${id}/cancel`)),
  award: (id: string, body: { bidId: string; taxRate?: number; justification?: string; overrunReason?: string }) =>
    data<{ po?: PurchaseOrder; poError?: string }>(api.post(`/sourcing/rfqs/${id}/award`, body)),
  escalateBudget: (id: string, bidId: string, reason: string) => data<Rfq>(api.post(`/sourcing/rfqs/${id}/budget-escalation`, { bidId, reason })),
  decideEscalation: (id: string, decision: 'APPROVE' | 'REJECT', remarks?: string) =>
    data<Rfq>(api.post(`/sourcing/rfqs/${id}/budget-escalation/decision`, { decision, remarks })),
  emergencyPurchase: (body: { requisitionId: string; vendorId: string; prices: Record<string, number>; taxRate: number; deliveryDays: number; justification: string }) =>
    data<{ po: PurchaseOrder }>(api.post('/sourcing/emergency-purchases', body)),
  bids: (rfqId: string) => data<Bid[]>(api.get(`/sourcing/rfqs/${rfqId}/bids`)),
  myBid: (rfqId: string) => data<{ bid: Bid | null; totalBids?: number }>(api.get(`/sourcing/rfqs/${rfqId}/bids`)),
  submitBid: (rfqId: string, body: { items: { rfqItemId: string; unitPrice: number; taxRate: number }[]; deliveryDays: number; notes?: string }) =>
    data<Bid>(api.post(`/sourcing/rfqs/${rfqId}/bids`, body)),
  withdrawBid: (bidId: string) => data<Bid>(api.post(`/sourcing/bids/${bidId}/withdraw`)),
  setQualityScore: (bidId: string, qualityScore: number) =>
    data<Bid>(api.patch(`/sourcing/bids/${bidId}/quality-score`, { qualityScore })),
};

export const poApi = {
  list: (params?: Record<string, string>) => data<PurchaseOrder[]>(api.get('/purchase-orders', { params })),
  summary: () => data<PoSummary>(api.get('/purchase-orders/summary')),
  invoiceable: () => data<PurchaseOrder[]>(api.get('/purchase-orders/invoiceable')),
  createFromBid: (bidId: string) => data<PurchaseOrder>(api.post(`/purchase-orders/from-bid/${bidId}`, {})),
  approve: (id: string, remarks?: string) => data<PurchaseOrder>(api.post(`/purchase-orders/${id}/approve`, { remarks })),
  reject: (id: string, remarks: string) => data<PurchaseOrder>(api.post(`/purchase-orders/${id}/reject`, { remarks })),
  issue: (id: string) => data<PurchaseOrder>(api.post(`/purchase-orders/${id}/issue`)),
  cancel: (id: string, reason: string) => data<PurchaseOrder>(api.post(`/purchase-orders/${id}/cancel`, { reason })),
};

export const grnApi = {
  list: () => data<GoodsReceipt[]>(api.get('/grn')),
  inventory: () => data<InventoryItem[]>(api.get('/grn/inventory')),
  nearExpiry: () => data<{ days: number; rows: NearExpiryRow[] }>(api.get('/grn/inventory/near-expiry')),
  returns: () => data<ReturnNote[]>(api.get('/grn/returns')),
  createReturn: (grnId: string, body: { grnLineId: string; quantity: number; reason: string; resolution: 'REPLACE' | 'CREDIT' }) =>
    data<ReturnNote>(api.post(`/grn/${grnId}/returns`, body)),
  dispatchReturn: (id: string, carrierReference: string) => data<ReturnNote>(api.post(`/grn/returns/${id}/dispatch`, { carrierReference })),
  create: (body: {
    purchaseOrderId: string;
    warehouse: string;
    deliveryNoteNumber: string;
    physicalCheck: { boxesExpected: number; boxesCounted: number };
    qcRemarks?: string;
    items: {
      poItemId: string;
      receivedQty: number;
      acceptedQty: number;
      qualityStatus: string;
      rejectionReason?: string;
      shortageReason?: string;
      batchNumber?: string;
      expiryDate?: string;
      serialNumbers?: string[];
    }[];
  }) => data<GoodsReceipt>(api.post('/grn', body)),
};

export const serviceEntryApi = {
  list: () => data<ServiceEntry[]>(api.get('/service-entries')),
  create: (body: { purchaseOrderId: string; poItemId: string; quantity: number; completedOn: string; remarks?: string }) =>
    data<ServiceEntry>(api.post('/service-entries', body)),
  accept: (id: string) => data<ServiceEntry>(api.post(`/service-entries/${id}/accept`, {})),
  reject: (id: string, remarks: string) => data<ServiceEntry>(api.post(`/service-entries/${id}/reject`, { remarks })),
};

export const catalogApi = {
  search: (q: string) => data<CatalogItem[]>(api.get('/catalog/items', { params: { q } })),
};

/** Unread badges, and vendor conversations: a vendor's private line to Procurement on an RFQ. */
export const chatApi = {
  unread: () => data<ChatUnread>(api.get('/chat/unread')),
  vendorThreads: (rfqId: string) => data<VendorThread[]>(api.get(`/chat/rfqs/${rfqId}/vendors`)),
  vendorMessages: (rfqId: string, vendorId: string) => data<PrMessage[]>(api.get(`/chat/rfqs/${rfqId}/vendors/${vendorId}/messages`)),
  sendToVendor: (rfqId: string, vendorId: string, text: string) => data<PrMessage>(api.post(`/chat/rfqs/${rfqId}/vendors/${vendorId}/messages`, { text })),
  myMessages: (rfqId: string) => data<PrMessage[]>(api.get(`/chat/rfqs/${rfqId}/messages`)),
  sendToBuyer: (rfqId: string, text: string) => data<PrMessage>(api.post(`/chat/rfqs/${rfqId}/messages`, { text })),
};

export const journeyApi = {
  mine: () => data<{ tracks: JourneyTrack[]; yourActions: number }>(api.get('/journey')),
};

export const invoiceApi = {
  list: (params?: Record<string, string>) => data<Invoice[]>(api.get('/invoices', { params })),
  submit: (body: {
    purchaseOrderId: string;
    invoiceNumber: string;
    invoiceDate: string;
    claimedTotal: number;
    items: { poItemId: string; quantity: number; unitPrice: number; taxRate: number }[];
  }) => data<Invoice>(api.post('/invoices', body)),
  match: (id: string) => data<Invoice>(api.post(`/invoices/${id}/match`)),
  book: (id: string) => data<Invoice>(api.post(`/invoices/${id}/book`, {})),
  reject: (id: string, reason: string) => data<Invoice>(api.post(`/invoices/${id}/reject`, { reason })),
  decideException: (id: string, decision: 'ACCEPT' | 'REJECT', reason: string) =>
    data<Invoice>(api.post(`/invoices/${id}/exception-decision`, { decision, reason })),
  addNote: (id: string, type: 'debit' | 'credit', body: { taxableAmount: number; gstAmount: number; reason: string; vendorReference?: string }) =>
    data<Invoice>(api.post(`/invoices/${id}/${type}-notes`, body)),
};

export const treasuryApi = {
  queue: () =>
    data<{
      awaitingTax: Invoice[];
      awaitingApproval: Payment[];
      awaitingRelease: Payment[];
      processing: Payment[];
      failed: Payment[];
      exceptions: Invoice[];
      escalations: (Pick<Rfq, '_id' | 'rfqNumber' | 'title' | 'department' | 'budgetEscalation'>)[];
      ratifications: (Pick<Requisition, '_id' | 'prNumber' | 'title' | 'emergencyReason' | 'department' | 'requester' | 'items'> & {
        purchaseOrder?: { poNumber: string; subtotal: number; taxTotal: number; grandTotal: number; status: string };
      })[];
      tdsSections: Record<string, { label: string; individualRate: number; otherRate: number }>;
    }>(api.get('/treasury/queue')),
  verifyTax: (invoiceId: string, tdsSection?: string) => data<{ payment: Payment }>(api.post(`/treasury/invoices/${invoiceId}/verify-tax`, { tdsSection })),
  release: (paymentId: string, mode: string) => data<Payment>(api.post(`/treasury/payments/${paymentId}/release`, { mode })),
  payments: () => data<Payment[]>(api.get('/treasury/payments')),
  myApprovals: () => data<Payment[]>(api.get('/treasury/payments/my-approvals')),
  approve: (paymentId: string, remarks?: string) => data<Payment>(api.post(`/treasury/payments/${paymentId}/approve`, { remarks })),
  reject: (paymentId: string, remarks: string) => data<Payment>(api.post(`/treasury/payments/${paymentId}/reject`, { remarks })),
  retry: (paymentId: string, mode: string) => data<Payment>(api.post(`/treasury/payments/${paymentId}/retry`, { mode })),
  checkStatus: (paymentId: string) => data<Payment>(api.post(`/treasury/payments/${paymentId}/check-status`)),
};
