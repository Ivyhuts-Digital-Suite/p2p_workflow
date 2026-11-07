import { Request, Response } from 'express';
import { FilterQuery } from 'mongoose';
import { ROLES } from '../../constants/roles';
import { APPROVAL_STATUS, ESCALATION_STATUS, INVOICE_STATUS, PAYMENT_STATUS, PaymentMode, RATIFICATION_STATUS } from '../../constants/status';
import { currentUser } from '../../middleware/auth';
import { Invoice } from '../../models/Invoice';
import { IPayment, Payment } from '../../models/Payment';
import { PurchaseOrder } from '../../models/PurchaseOrder';
import { PurchaseRequisition } from '../../models/PurchaseRequisition';
import { RFQ } from '../../models/RFQ';
import { Vendor } from '../../models/Vendor';
import { assertTransferAllowed, initiateTransfer, isValidWebhookSignature, queryTransfer, TransferResult } from '../../services/bank.service';
import { optionalApprovalChain } from '../../services/doa.service';
import { failPayment, settlePayment } from '../../services/payment.service';
import { TDS_SECTIONS, verifyTaxCompliance } from '../../services/tax.service';
import { loadDirectory, paymentPendingAt } from '../../services/workflow.service';
import { AuthUser } from '../../types/auth';
import { ApiError } from '../../utils/ApiError';
import { asyncHandler } from '../../utils/asyncHandler';
import { round2 } from '../../utils/money';
import { oid } from '../../utils/objectId';
import { nextDocNumber } from '../../utils/sequence';

const paymentPopulate = [
  { path: 'vendor', select: 'companyName vendorCode contactPerson' },
  { path: 'invoice', select: 'invoiceNumber internalRef dueDate subtotal gstAmount total items.description' },
  { path: 'verifiedBy', select: 'name' },
];

/** Work queues: exceptions to decide, booked invoices awaiting tax clearance, and payments at each stage. */
export const treasuryQueue = asyncHandler(async (req, res) => {
  const directory = await loadDirectory(currentUser(req));
  const [awaitingTax, awaitingApproval, awaitingRelease, processing, failed, exceptions, escalations, ratifications] = await Promise.all([
    Invoice.find({ status: INVOICE_STATUS.BOOKED })
      .populate('vendor', 'companyName vendorCode gstin pan tdsSection contactPerson')
      .populate('purchaseOrder', 'poNumber')
      .sort({ dueDate: 1, createdAt: 1 }),
    Payment.find({ status: PAYMENT_STATUS.PENDING_APPROVAL }).populate(paymentPopulate).sort({ createdAt: 1 }),
    Payment.find({ status: PAYMENT_STATUS.PENDING_RELEASE }).populate(paymentPopulate).sort({ createdAt: 1 }),
    Payment.find({ status: PAYMENT_STATUS.PROCESSING }).populate(paymentPopulate).sort({ releasedAt: 1 }),
    Payment.find({ status: PAYMENT_STATUS.FAILED }).populate(paymentPopulate).sort({ updatedAt: -1 }),
    Invoice.find({ status: INVOICE_STATUS.EXCEPTION })
      .populate('vendor', 'companyName contactPerson')
      .populate('purchaseOrder', 'poNumber')
      .sort({ createdAt: 1 }),
    RFQ.find({ 'budgetEscalation.status': ESCALATION_STATUS.PENDING })
      .select('rfqNumber title department budgetEscalation')
      .populate('department', 'name code')
      .populate('budgetEscalation.requestedBy', 'name'),
    PurchaseRequisition.find({ isEmergency: true, 'ratification.status': RATIFICATION_STATUS.PENDING })
      .select('prNumber title emergencyReason totalEstimate department requester purchaseOrder ratification items.description')
      .populate('department', 'name code')
      .populate('requester', 'name')
      .populate('purchaseOrder', 'poNumber subtotal taxTotal grandTotal status'),
  ]);
  const withPending = (payments: typeof awaitingApproval) =>
    payments.map((p) => ({ ...p.toObject(), pendingAt: paymentPendingAt(p, directory) }));
  res.json({
    awaitingTax,
    awaitingApproval: withPending(awaitingApproval),
    awaitingRelease: withPending(awaitingRelease),
    processing,
    failed,
    exceptions,
    escalations,
    ratifications,
    tdsSections: TDS_SECTIONS,
  });
});

/**
 * Tax compliance check (GSTIN/PAN validity, GST rate and supply type, TDS computation).
 * On success the invoice moves to TAX_VERIFIED and a payment is staged for release, first
 * going through any approval chain a PAYMENT DoA rule sets for its value. Debit and credit
 * notes reduce the amount paid and the base for TDS.
 */
export const verifyInvoiceTax = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) throw ApiError.notFound('Invoice');
  if (invoice.status !== INVOICE_STATUS.BOOKED) throw ApiError.unprocessable('Only booked invoices can be tax-verified');

  const po = await PurchaseOrder.findById(invoice.purchaseOrder).select('department requisitions poNumber');
  if (po && (await PurchaseRequisition.exists({ _id: { $in: po.requisitions }, isEmergency: true, 'ratification.status': { $in: [RATIFICATION_STATUS.PENDING, RATIFICATION_STATUS.REJECTED] } }))) {
    throw ApiError.unprocessable(`Action locked: ${po.poNumber} is an emergency purchase that Finance must ratify before it can be paid`);
  }

  const vendor = await Vendor.findById(invoice.vendor);
  if (!vendor) throw ApiError.notFound('Vendor');

  const result = verifyTaxCompliance(invoice, vendor, req.body.tdsSection ?? vendor.tdsSection);
  const noteTaxable = invoice.adjustments.reduce((sum, n) => sum + n.taxableAmount, 0);
  const noteTotal = round2(invoice.adjustments.reduce((sum, n) => sum + n.total, 0));
  const tdsAmount = round2(((invoice.subtotal - noteTaxable) * result.tdsRate) / 100);
  const grossAmount = round2(invoice.total - noteTotal);
  const netPayable = round2(grossAmount - tdsAmount);
  invoice.tax = { ...result, tdsAmount, netPayable, verifiedBy: oid(user.id), verifiedAt: new Date() };

  if (!result.verified) {
    await invoice.save();
    throw ApiError.unprocessable('Tax compliance check failed', result.issues);
  }
  if (!vendor.bankDetails?.accountNumber || !vendor.bankDetails.ifsc) {
    throw ApiError.unprocessable('Vendor bank details are missing');
  }

  const chain = await optionalApprovalChain('PAYMENT', grossAmount);
  invoice.status = INVOICE_STATUS.TAX_VERIFIED;
  const payment = await Payment.create({
    paymentRef: await nextDocNumber('PAY'),
    invoice: invoice._id,
    vendor: vendor._id,
    department: po?.department,
    grossAmount,
    adjustmentTotal: noteTotal,
    tdsAmount,
    netAmount: netPayable,
    beneficiary: vendor.bankDetails,
    verifiedBy: user.id,
    approvals: chain.map((l) => ({ level: l.level, role: l.role, status: APPROVAL_STATUS.PENDING })),
    status: chain.length ? PAYMENT_STATUS.PENDING_APPROVAL : PAYMENT_STATUS.PENDING_RELEASE,
  });
  invoice.payment = payment._id;
  await invoice.save();

  res.json({ invoice, payment });
});

/** The next approval step on a payment, if the caller may take it. Nobody who verified or approved it may approve it again. */
function assertPaymentApprover(payment: IPayment, user: AuthUser) {
  const step = payment.approvals.find((a) => a.status === APPROVAL_STATUS.PENDING);
  if (payment.status !== PAYMENT_STATUS.PENDING_APPROVAL || !step) throw ApiError.unprocessable(`Payment is ${payment.status}`);
  if (user.role !== ROLES.ADMIN && user.role !== step.role) throw ApiError.forbidden(`This approval requires role ${step.role}`);
  if (user.role === ROLES.HOD && payment.department?.toString() !== user.department) {
    throw ApiError.forbidden('Only the HOD of the ordering department can approve this level');
  }
  if (payment.verifiedBy.toString() === user.id) throw ApiError.forbidden('The user who verified tax cannot also approve the payment');
  if (payment.approvals.some((a) => a.actedBy?.toString() === user.id)) throw ApiError.forbidden('You have already approved an earlier level of this payment');
  return step;
}

export const approvePayment = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const payment = await Payment.findById(req.params.id);
  if (!payment) throw ApiError.notFound('Payment');
  const step = assertPaymentApprover(payment, user);

  step.status = APPROVAL_STATUS.APPROVED;
  step.actedBy = oid(user.id);
  step.actedAt = new Date();
  step.remarks = req.body.remarks;
  if (payment.approvals.every((a) => a.status === APPROVAL_STATUS.APPROVED)) payment.status = PAYMENT_STATUS.PENDING_RELEASE;
  await payment.save();
  res.json(payment);
});

/** A rejected payment joins the failed-payment queue. Retrying sends it back through the whole approval chain. */
export const rejectPayment = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const payment = await Payment.findById(req.params.id);
  if (!payment) throw ApiError.notFound('Payment');
  const step = assertPaymentApprover(payment, user);

  step.status = APPROVAL_STATUS.REJECTED;
  step.actedBy = oid(user.id);
  step.actedAt = new Date();
  step.remarks = req.body.remarks;
  payment.status = PAYMENT_STATUS.FAILED;
  payment.failureReason = `Rejected by ${user.name}: ${req.body.remarks}`;
  await payment.save();
  res.json(payment);
});

/** Applies the bank's answer. Only a definite failure stops a payment: an unknown outcome stays PROCESSING until the bank says. */
async function applyTransferResult(res: Response, paymentId: unknown, transfer: TransferResult) {
  if (transfer.status === 'SUCCESS') {
    const settled = await settlePayment(paymentId, transfer.utr, transfer.simulated);
    return res.json(settled ?? (await Payment.findById(paymentId)));
  }
  if (transfer.status === 'FAILED') {
    await failPayment(paymentId, transfer.failureReason);
    throw ApiError.unprocessable(`Bank transfer failed: ${transfer.failureReason}`);
  }
  return res.status(202).json(await Payment.findById(paymentId));
}

/**
 * Sends the payment to the bank. The move to PROCESSING happens in one update before the call, so two
 * simultaneous clicks can't pay twice. Each attempt has its own reference, the bank's idempotency key.
 * Finance both verifies and releases, so the independent check on a payment is its approval chain:
 * whoever approved a payment cannot also release it, and that includes an Admin.
 */
async function sendToBank(req: Request, res: Response, from: string) {
  const user = currentUser(req);
  const payment = await Payment.findById(req.params.id);
  if (!payment) throw ApiError.notFound('Payment');
  if (payment.status !== from) throw ApiError.unprocessable(`Payment is ${payment.status}`);
  if (payment.approvals.some((a) => a.actedBy?.toString() === user.id)) {
    throw ApiError.forbidden('Whoever approved a payment cannot also release it');
  }

  // A retry picks up corrected bank details, since a wrong account is the usual reason for a failure.
  const vendor = from === PAYMENT_STATUS.FAILED ? await Vendor.findById(payment.vendor).select('bankDetails') : null;
  const beneficiary = vendor?.bankDetails?.accountNumber ? vendor.bankDetails : payment.beneficiary;
  if (!beneficiary?.accountNumber) throw ApiError.unprocessable('Beneficiary account missing');

  const mode = req.body.mode as PaymentMode;
  assertTransferAllowed(payment.netAmount, mode);

  const attempt = payment.attempts + 1;
  const reference = `${payment.paymentRef}-${attempt}`;
  const claimed = await Payment.findOneAndUpdate(
    { _id: payment._id, status: from, attempts: payment.attempts },
    {
      $set: { status: PAYMENT_STATUS.PROCESSING, mode, releasedBy: oid(user.id), releasedAt: new Date(), bankReference: reference, attempts: attempt, beneficiary },
      $unset: { failureReason: 1 },
    },
    { new: true },
  );
  if (!claimed) throw ApiError.conflict('This payment is already being released');

  const transfer = await initiateTransfer({
    amount: claimed.netAmount,
    mode,
    reference,
    beneficiaryName: beneficiary.accountName,
    accountNumber: beneficiary.accountNumber,
    ifsc: beneficiary.ifsc,
  });
  return applyTransferResult(res, claimed._id, transfer);
}

export const releasePayment = asyncHandler((req, res) => sendToBank(req, res, PAYMENT_STATUS.PENDING_RELEASE));

/** Retries a failed payment, or restarts the approval chain if an approver rejected it. */
export const retryPayment = asyncHandler(async (req, res) => {
  const payment = await Payment.findById(req.params.id);
  if (!payment) throw ApiError.notFound('Payment');
  if (payment.status === PAYMENT_STATUS.FAILED && payment.approvals.some((a) => a.status === APPROVAL_STATUS.REJECTED)) {
    for (const step of payment.approvals) {
      step.status = APPROVAL_STATUS.PENDING;
      step.actedBy = undefined;
      step.actedAt = undefined;
    }
    payment.status = PAYMENT_STATUS.PENDING_APPROVAL;
    payment.failureReason = undefined;
    await payment.save();
    return res.json(payment);
  }
  return sendToBank(req, res, PAYMENT_STATUS.FAILED);
});

/** Asks the bank what happened to a payment stuck in PROCESSING, for when a webhook never arrives. */
export const checkPaymentStatus = asyncHandler(async (req, res) => {
  const payment = await Payment.findById(req.params.id);
  if (!payment) throw ApiError.notFound('Payment');
  if (payment.status !== PAYMENT_STATUS.PROCESSING || !payment.bankReference) throw ApiError.unprocessable(`Payment is ${payment.status}`);
  const transfer = await queryTransfer(payment.bankReference);
  if (!transfer) throw new ApiError(503, 'The bank could not say what happened to this payment. Please try again later.');
  return applyTransferResult(res, payment._id, transfer);
});

/**
 * The bank reports the outcome of a transfer. Authenticated by an HMAC signature over the raw body, not a
 * session. Safe to repeat: only the first report moves a payment out of PROCESSING, and a report for an
 * earlier attempt is logged, not applied. It answers 200 for those, so that the bank stops retrying.
 */
export const bankWebhook = asyncHandler(async (req, res) => {
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!isValidWebhookSignature(rawBody, req.headers['x-bank-signature'])) {
    throw ApiError.unauthorized('Invalid webhook signature');
  }
  const { reference, status, utr, failureReason, amount } = req.body;

  const payment = await Payment.findOne({ bankReference: reference });
  if (!payment) {
    console.error(`[bank] webhook for unknown or superseded reference ${reference}, status ${status}: needs manual reconciliation`);
    return res.json({ received: true, applied: false });
  }
  if (amount !== undefined && round2(amount) !== payment.netAmount) {
    console.error(`[bank] webhook amount ${amount} differs from ${payment.netAmount} on ${payment.paymentRef}: not applied`);
    throw ApiError.unprocessable('The amount does not match this payment');
  }

  const changed = status === 'SUCCESS' ? await settlePayment(payment._id, utr) : await failPayment(payment._id, failureReason);
  if (!changed && payment.status === PAYMENT_STATUS.FAILED && status === 'SUCCESS') {
    console.error(`[bank] SUCCESS reported for ${reference}, which was marked failed: needs manual reconciliation`);
  }
  res.json({ received: true, applied: !!changed });
});

export const listPayments = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const filter: FilterQuery<IPayment> = user.role === ROLES.VENDOR ? { vendor: user.vendor } : {};
  if (req.query.status) filter.status = String(req.query.status);

  const payments = await Payment.find(filter)
    .select(user.role === ROLES.VENDOR ? '-beneficiary -verifiedBy -releasedBy -approvals -bankReference -department' : '')
    .populate('vendor', 'companyName vendorCode contactPerson')
    .populate('invoice', 'invoiceNumber internalRef total subtotal gstAmount items.description')
    .sort({ createdAt: -1 });
  res.json(payments);
});

/** Payments waiting on the caller's own approval, for roles outside the Finance queues. */
export const myPaymentApprovals = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const pending = await Payment.find({ status: PAYMENT_STATUS.PENDING_APPROVAL }).populate(paymentPopulate).sort({ createdAt: 1 });
  res.json(
    pending.filter((p) => {
      const step = p.approvals.find((a) => a.status === APPROVAL_STATUS.PENDING);
      if (user.role === ROLES.ADMIN) return true;
      return step?.role === user.role && (user.role !== ROLES.HOD || p.department?.toString() === user.department);
    }),
  );
});
