import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const submitInvoiceSchema = z.object({
  purchaseOrderId: objectId,
  invoiceNumber: z.string().min(1).max(32),
  invoiceDate: z.coerce.date().refine((d) => d <= new Date(), 'Invoice date cannot be in the future'),
  dueDate: z.coerce.date().optional(),
  /** Gross total printed on the invoice */
  claimedTotal: z.number().nonnegative(),
  /** Boxes / cartons on the vendor's paperwork */
  boxesOnPaperwork: z.number().int().nonnegative().default(0),
  items: z
    .array(
      z.object({
        poItemId: objectId,
        quantity: z.number().positive(),
        unitPrice: z.number().nonnegative(),
        taxRate: z.number().nonnegative(),
      }),
    )
    .min(1),
});

export const bookLiabilitySchema = z.object({
  glAccount: z.string().default('2100-AP-TRADE'),
});

export const rejectInvoiceSchema = z.object({ reason: z.string().min(3) });

export const exceptionDecisionSchema = z.object({
  decision: z.enum(['ACCEPT', 'REJECT']),
  reason: z.string().trim().min(10, 'Give a reason of at least 10 characters'),
});

export const adjustmentNoteSchema = z.object({
  taxableAmount: z.number().positive(),
  gstAmount: z.number().nonnegative().default(0),
  reason: z.string().trim().min(3),
  /** The vendor's own number, for a credit note */
  vendorReference: z.string().trim().optional(),
  returnNoteId: objectId.optional(),
});
