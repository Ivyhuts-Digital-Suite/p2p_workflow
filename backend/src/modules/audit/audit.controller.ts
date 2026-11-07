import { RFQ_STATUS } from '../../constants/status';
import { AuditLog } from '../../models/AuditLog';
import { Invoice } from '../../models/Invoice';
import { Payment } from '../../models/Payment';
import { RFQ } from '../../models/RFQ';
import { Vendor } from '../../models/Vendor';
import { asyncHandler } from '../../utils/asyncHandler';

const MAX_ROWS = 500;

/** Every state-changing action, newest first, including refused attempts. */
export const activity = asyncHandler(async (req, res) => {
  const filter: Record<string, unknown> = {};
  if (req.query.module) filter.module = String(req.query.module);
  if (req.query.success !== undefined) filter.success = req.query.success === 'true';
  res.json(await AuditLog.find(filter).sort({ at: -1 }).limit(MAX_ROWS));
});

/** PO vs GRN vs invoice results, including the exceptions that were raised. */
export const matchingLogs = asyncHandler(async (_req, res) => {
  res.json(
    await Invoice.find({ 'match.performedAt': { $exists: true } })
      .select('invoiceNumber internalRef vendor purchaseOrder total status match')
      .populate('vendor', 'companyName vendorCode')
      .populate('purchaseOrder', 'poNumber')
      .populate('match.performedBy', 'name role')
      .sort({ 'match.performedAt': -1 })
      .limit(MAX_ROWS),
  );
});

/** Tax verification results, who verified and released each payment, and vendor KYC status. */
export const compliance = asyncHandler(async (_req, res) => {
  const [invoices, payments, vendors] = await Promise.all([
    Invoice.find({ 'tax.verifiedAt': { $exists: true } })
      .select('invoiceNumber internalRef vendor total status tax')
      .populate('vendor', 'companyName vendorCode gstin pan')
      .populate('tax.verifiedBy', 'name role')
      .sort({ 'tax.verifiedAt': -1 })
      .limit(MAX_ROWS),
    Payment.find()
      .select('paymentRef vendor invoice grossAmount tdsAmount netAmount mode utr status verifiedBy releasedBy releasedByName releasedAt')
      .populate('vendor', 'companyName vendorCode')
      .populate('invoice', 'invoiceNumber internalRef')
      .populate('verifiedBy', 'name role')
      .populate('releasedBy', 'name role')
      .sort({ createdAt: -1 })
      .limit(MAX_ROWS),
    Vendor.find().select('vendorCode companyName gstin pan tdsSection status').sort({ companyName: 1 }),
  ]);
  res.json({ invoices, payments, vendors });
});

/** Award decisions with their rank at award and any written justification for a non-L1 choice. */
export const awards = asyncHandler(async (_req, res) => {
  res.json(
    await RFQ.find({ status: RFQ_STATUS.AWARDED })
      .select('rfqNumber title awardedBid awardJustification awardedBy awardedAt')
      .populate({
        path: 'awardedBid',
        select: 'vendor totalAmount rank',
        populate: { path: 'vendor', select: 'companyName vendorCode' },
      })
      .populate('awardedBy', 'name role')
      .sort({ awardedAt: -1 })
      .limit(MAX_ROWS),
  );
});
