import { FilterQuery } from 'mongoose';
import { ROLES } from '../../constants/roles';
import { INVOICE_STATUS, MATCH_STATUS, OVERRIDABLE_EXCEPTIONS, PO_INVOICEABLE_STATUSES, PO_STATUS } from '../../constants/status';
import { currentUser } from '../../middleware/auth';
import { IInvoice, Invoice, InvoiceDocument } from '../../models/Invoice';
import { PurchaseOrder } from '../../models/PurchaseOrder';
import { clearedQuantities, MatchResult, performThreeWayMatch } from '../../services/matching.service';
import { invoicePendingAt, loadDirectory } from '../../services/workflow.service';
import { AuthUser } from '../../types/auth';
import { ApiError } from '../../utils/ApiError';
import { asyncHandler } from '../../utils/asyncHandler';
import { round2 } from '../../utils/money';
import { oid } from '../../utils/objectId';
import { nextDocNumber } from '../../utils/sequence';

const scope = (user: AuthUser): FilterQuery<IInvoice> => (user.role === ROLES.VENDOR ? { vendor: user.vendor } : {});

async function loadInvoice(id: string, user: AuthUser): Promise<InvoiceDocument> {
  const invoice = await Invoice.findOne({ _id: id, ...scope(user) });
  if (!invoice) throw ApiError.notFound('Invoice');
  return invoice;
}

/** True when every exception has been accepted by Finance. Any new or different exception still stops the invoice. */
function isCleared(invoice: InvoiceDocument, result: MatchResult) {
  if (result.status === MATCH_STATUS.MATCHED) return true;
  const accepted = invoice.exceptionDecision?.exceptionTypes ?? [];
  return result.exceptions.every((e) => accepted.includes(e.type));
}

function applyMatch(invoice: InvoiceDocument, result: MatchResult, user: AuthUser) {
  invoice.match = { ...result, performedBy: oid(user.id), performedAt: new Date() };
  invoice.status = isCleared(invoice, result) ? INVOICE_STATUS.MATCHED : INVOICE_STATUS.EXCEPTION;
}

/**
 * Vendor (via portal) or Finance (keying a paper invoice) records an invoice against a PO.
 * Duplicates are blocked and the 3-way match runs straight away; Finance re-runs it after new GRNs.
 * A vendor cannot bill goods until the Store has accepted something on the billed lines.
 */
export const submitInvoice = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const { purchaseOrderId, items, ...header } = req.body;

  const po = await PurchaseOrder.findById(purchaseOrderId);
  if (!po || (user.role === ROLES.VENDOR && po.vendor.toString() !== user.vendor)) {
    throw ApiError.notFound('Purchase order');
  }
  if (user.role === ROLES.VENDOR && po.status === PO_STATUS.ISSUED) {
    throw ApiError.unprocessable('Acknowledge this PO before submitting an invoice against it');
  }
  if (!PO_INVOICEABLE_STATUSES.includes(po.status)) throw ApiError.unprocessable(`Cannot invoice a PO that is ${po.status}`);
  if (await Invoice.exists({ vendor: po.vendor, invoiceNumber: header.invoiceNumber.trim().toUpperCase() })) {
    throw ApiError.conflict('Duplicate invoice blocked: this vendor has already submitted this invoice number');
  }

  const lines = items.map((line: { poItemId: string; quantity: number; unitPrice: number; taxRate: number }) => {
    const poItem = po.items.find((i) => i._id.equals(line.poItemId));
    if (!poItem) throw ApiError.unprocessable(`PO line ${line.poItemId} not found`);
    return { poItem: poItem._id, description: poItem.description, quantity: line.quantity, unitPrice: line.unitPrice, taxRate: line.taxRate };
  });

  if (user.role === ROLES.VENDOR) {
    const cleared = await clearedQuantities([po]);
    const billable = lines.some((line: { poItem: { toString(): string } }) => {
      const poItem = po.items.find((i) => i._id.toString() === line.poItem.toString())!;
      return (cleared.get(poItem._id.toString()) ?? 0) > poItem.invoicedQty;
    });
    if (!billable) {
      throw ApiError.unprocessable('Action locked: goods receipt or service sign-off is pending at the hospital. Please wait until completion.');
    }
  }

  const invoice = await Invoice.create({
    ...header,
    internalRef: await nextDocNumber('INV'),
    vendor: po.vendor,
    purchaseOrder: po._id,
    items: lines,
    submittedBy: user.id,
  });

  applyMatch(invoice, await performThreeWayMatch(invoice), user);
  await invoice.save();
  res.status(201).json(invoice);
});

export const listInvoices = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const filter: FilterQuery<IInvoice> = scope(user);
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.purchaseOrder) filter.purchaseOrder = String(req.query.purchaseOrder);

  const invoices = await Invoice.find(filter)
    .populate('vendor', 'companyName vendorCode contactPerson')
    .populate('purchaseOrder', 'poNumber grandTotal')
    .sort({ createdAt: -1 });
  const directory = await loadDirectory(user);
  res.json(invoices.map((invoice) => ({ ...invoice.toObject(), pendingAt: invoicePendingAt(invoice, directory) })));
});

export const getInvoice = asyncHandler(async (req, res) => {
  const invoice = await loadInvoice(req.params.id, currentUser(req));
  await invoice.populate([
    { path: 'vendor', select: 'companyName vendorCode gstin pan contactPerson' },
    { path: 'purchaseOrder', select: 'poNumber items grandTotal' },
  ]);
  res.json(invoice);
});

/** Finance runs the PO vs GRN vs Invoice match. Can be re-run after new GRNs arrive. */
export const matchInvoice = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const invoice = await loadInvoice(req.params.id, user);
  if (!([INVOICE_STATUS.SUBMITTED, INVOICE_STATUS.EXCEPTION, INVOICE_STATUS.MATCHED] as string[]).includes(invoice.status)) {
    throw ApiError.unprocessable(`Invoice is ${invoice.status}`);
  }

  applyMatch(invoice, await performThreeWayMatch(invoice), user);
  await invoice.save();
  res.json(invoice);
});

/**
 * Books the liability for a matched invoice. The match is re-run at booking time so
 * an invoice booked in the meantime against the same PO lines cannot cause double billing.
 */
export const bookLiability = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const invoice = await loadInvoice(req.params.id, user);
  if (invoice.status !== INVOICE_STATUS.MATCHED) {
    throw ApiError.unprocessable('Only a successfully matched invoice can be booked');
  }

  const result = await performThreeWayMatch(invoice);
  if (!isCleared(invoice, result)) {
    invoice.match = { ...result, performedBy: oid(user.id), performedAt: new Date() };
    invoice.status = INVOICE_STATUS.EXCEPTION;
    await invoice.save();
    throw ApiError.unprocessable('Invoice no longer matches - see exceptions', result.exceptions);
  }

  const po = await PurchaseOrder.findById(invoice.purchaseOrder);
  if (!po) throw ApiError.notFound('Purchase order');
  for (const line of invoice.items) {
    const poItem = po.items.find((i) => i._id.equals(line.poItem))!;
    poItem.invoicedQty = round2(poItem.invoicedQty + line.quantity);
  }
  await po.save(); // optimistic concurrency guards parallel bookings

  invoice.liability = { glAccount: req.body.glAccount, bookedBy: oid(user.id), bookedAt: new Date() };
  invoice.status = INVOICE_STATUS.BOOKED;
  await invoice.save();
  res.json(invoice);
});

export const rejectInvoice = asyncHandler(async (req, res) => {
  const invoice = await loadInvoice(req.params.id, currentUser(req));
  if (!([INVOICE_STATUS.SUBMITTED, INVOICE_STATUS.EXCEPTION, INVOICE_STATUS.MATCHED] as string[]).includes(invoice.status)) {
    throw ApiError.unprocessable(`Invoice is ${invoice.status}`);
  }
  invoice.status = INVOICE_STATUS.REJECTED;
  invoice.rejectionReason = req.body.reason;
  await invoice.save();
  res.json(invoice);
});

/**
 * Finance decides a match exception. Accepting needs a written reason and only ever covers price and
 * tax differences. Quantity, vendor and line exceptions can't be accepted, because that would mean
 * paying for goods not received or not ordered.
 */
export const decideException = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const invoice = await loadInvoice(req.params.id, user);
  if (invoice.status !== INVOICE_STATUS.EXCEPTION) throw ApiError.unprocessable('This invoice has no exception awaiting a decision');

  if (req.body.decision === 'REJECT') {
    invoice.status = INVOICE_STATUS.REJECTED;
    invoice.rejectionReason = req.body.reason;
    await invoice.save();
    return res.json(invoice);
  }

  // Decided on a fresh match, so Finance is never accepting exceptions that have since changed.
  const result = await performThreeWayMatch(invoice);
  const blocking = result.exceptions.filter((e) => !OVERRIDABLE_EXCEPTIONS.includes(e.type));
  if (blocking.length) {
    invoice.match = { ...result, performedBy: oid(user.id), performedAt: new Date() };
    await invoice.save();
    throw ApiError.unprocessable('These exceptions cannot be accepted: resolve them or reject the invoice', blocking);
  }
  invoice.exceptionDecision = {
    exceptionTypes: [...new Set(result.exceptions.map((e) => e.type))],
    reason: req.body.reason,
    decidedBy: oid(user.id),
    decidedAt: new Date(),
  };
  applyMatch(invoice, result, user);
  await invoice.save();
  res.json(invoice);
});

/** Adds a debit note (raised by us) or credit note (issued by the vendor). Both reduce what is paid, and must come before tax verification. */
const addNote = (type: 'DEBIT' | 'CREDIT') =>
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const invoice = await loadInvoice(req.params.id, user);
    if (([INVOICE_STATUS.TAX_VERIFIED, INVOICE_STATUS.PAID, INVOICE_STATUS.REJECTED] as string[]).includes(invoice.status)) {
      throw ApiError.unprocessable(`A note cannot be added to an invoice that is ${invoice.status}`);
    }
    const { taxableAmount, gstAmount, reason, vendorReference, returnNoteId } = req.body;
    const total = round2(taxableAmount + gstAmount);
    const existing = invoice.adjustments.reduce((sum, n) => sum + n.total, 0);
    if (round2(existing + total) >= invoice.total) {
      throw ApiError.unprocessable('These notes would cover the whole invoice: reject the invoice instead');
    }

    invoice.adjustments.push({
      type,
      noteNumber: await nextDocNumber(type === 'DEBIT' ? 'DN' : 'CN'),
      vendorReference,
      taxableAmount,
      gstAmount,
      total,
      reason,
      returnNote: returnNoteId,
      createdBy: oid(user.id),
      createdAt: new Date(),
    } as InvoiceDocument['adjustments'][number]);
    await invoice.save();
    res.status(201).json(invoice);
  });

export const addDebitNote = addNote('DEBIT');
export const addCreditNote = addNote('CREDIT');
