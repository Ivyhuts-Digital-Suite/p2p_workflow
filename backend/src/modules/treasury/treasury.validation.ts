import { z } from 'zod';
import { PAYMENT_MODE, enumValues } from '../../constants/status';
import { TDS_SECTIONS } from '../../services/tax.service';

export const verifyTaxSchema = z.object({
  /** Overrides the vendor's default TDS section for this invoice */
  tdsSection: z.enum(Object.keys(TDS_SECTIONS) as [string, ...string[]]).optional(),
});

export const releasePaymentSchema = z.object({
  mode: z.enum(enumValues(PAYMENT_MODE) as [string, ...string[]]).default(PAYMENT_MODE.NEFT),
});

export const paymentDecisionSchema = z.object({ remarks: z.string().trim().optional() });
export const paymentRejectionSchema = z.object({ remarks: z.string().trim().min(3, 'Give the reason for rejecting this payment') });

export const webhookSchema = z.object({
  reference: z.string().min(1),
  status: z.enum(['SUCCESS', 'FAILED']),
  utr: z.string().optional(),
  failureReason: z.string().optional(),
  amount: z.number().optional(),
});
