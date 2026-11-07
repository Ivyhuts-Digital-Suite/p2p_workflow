import { INVOICE_STATUS, PAYMENT_STATUS, PO_STATUS } from '../constants/status';
import { Department } from '../models/Department';
import { Invoice } from '../models/Invoice';
import { Payment, PaymentDocument } from '../models/Payment';
import { PurchaseOrder } from '../models/PurchaseOrder';
import { round2 } from '../utils/money';

/**
 * Records a successful transfer: pays the invoice, adds to actual budget use, and closes the PO
 * if nothing remains. Only one caller can move a payment out of PROCESSING, so a repeated webhook
 * changes nothing. Returns the payment when this call settled it, or null when it did not.
 */
export async function settlePayment(paymentId: unknown, utr?: string, simulated = false): Promise<PaymentDocument | null> {
  const payment = await Payment.findOneAndUpdate(
    { _id: paymentId, status: PAYMENT_STATUS.PROCESSING },
    { $set: { status: PAYMENT_STATUS.RELEASED, utr, simulated }, $unset: { failureReason: 1 } },
    { new: true },
  );
  if (!payment) return null;

  const invoice = await Invoice.findByIdAndUpdate(payment.invoice, { status: INVOICE_STATUS.PAID }, { new: true });
  if (!invoice) return payment;
  const po = await PurchaseOrder.findById(invoice.purchaseOrder);
  if (!po) return payment;

  // Budget actuals use the taxable value: input GST is recoverable and not a cost to the department.
  const noteValue = invoice.adjustments.reduce((sum, n) => sum + n.taxableAmount, 0);
  await Department.updateOne({ _id: po.department }, { $inc: { 'budget.consumed': round2(invoice.subtotal - noteValue) } });

  const unpaid = await Invoice.exists({
    purchaseOrder: po._id,
    status: { $in: [INVOICE_STATUS.BOOKED, INVOICE_STATUS.TAX_VERIFIED] },
  });
  const finished = po.items.every((i) => i.invoicedQty >= i.quantity && i.receivedQty >= i.quantity);
  if (!unpaid && finished && po.status !== PO_STATUS.SHORT_CLOSED) {
    po.status = PO_STATUS.CLOSED;
    await po.save();
  }
  return payment;
}

/** Records a failed transfer, which puts the payment in the failed-payment queue for a retry. */
export async function failPayment(paymentId: unknown, failureReason?: string): Promise<PaymentDocument | null> {
  return Payment.findOneAndUpdate(
    { _id: paymentId, status: PAYMENT_STATUS.PROCESSING },
    { $set: { status: PAYMENT_STATUS.FAILED, failureReason: failureReason ?? 'Refused by the bank' } },
    { new: true },
  );
}
