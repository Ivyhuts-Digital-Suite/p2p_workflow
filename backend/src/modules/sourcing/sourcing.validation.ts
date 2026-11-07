import { z } from 'zod';
import { GST_SLABS, LICENCE_TYPES, TECHNICAL_STATUS } from '../../constants/status';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const gstRate = z.number().refine((r) => GST_SLABS.includes(r), `GST rate must be one of ${GST_SLABS.join(', ')}`);

export const createRfqSchema = z
  .object({
    title: z.string().min(3),
    description: z.string().optional(),
    requisitionIds: z.array(objectId).min(1),
    /** Leave empty for an open tender visible to all approved vendors */
    invitedVendorIds: z.array(objectId).default([]),
    openAt: z.coerce.date().optional(),
    closeAt: z.coerce.date(),
    /** Two-envelope tender: prices stay sealed until the technical review is finished */
    technicalEvaluation: z.boolean().default(false),
    requiredLicences: z.array(z.enum(LICENCE_TYPES)).default([]),
  })
  .refine((v) => v.closeAt > new Date(), { message: 'closeAt must be in the future', path: ['closeAt'] });

export const submitBidSchema = z.object({
  items: z.array(z.object({ rfqItemId: objectId, unitPrice: z.number().nonnegative(), taxRate: gstRate.default(18) })).min(1),
  deliveryDays: z.number().int().nonnegative(),
  validityDays: z.number().int().positive().default(30),
  notes: z.string().optional(),
});

export const qualityScoreSchema = z.object({ qualityScore: z.number().min(0).max(100) });

export const awardSchema = z.object({
  bidId: objectId,
  /** Mandatory when awarding to anyone other than the L1 bidder */
  justification: z.string().trim().min(10, 'Justification must be at least 10 characters').optional(),
  /** Overrides the GST the vendor quoted, on every line of the generated PO */
  taxRate: gstRate.optional(),
  /** Written reason for accepting a quote above the requisition estimate */
  overrunReason: z.string().trim().min(10, 'The reason must be at least 10 characters').optional(),
});

export const technicalReviewSchema = z
  .object({
    result: z.enum([TECHNICAL_STATUS.QUALIFIED, TECHNICAL_STATUS.DISQUALIFIED]),
    remarks: z.string().trim().optional(),
    technicalScore: z.number().min(0).max(100).optional(),
  })
  .refine((r) => r.result === TECHNICAL_STATUS.QUALIFIED || (r.remarks?.length ?? 0) >= 3, {
    message: 'Give the reason for disqualifying this bid',
    path: ['remarks'],
  });

export const budgetEscalationSchema = z.object({ bidId: objectId, reason: z.string().trim().min(10, 'The reason must be at least 10 characters') });

export const escalationDecisionSchema = z
  .object({ decision: z.enum(['APPROVE', 'REJECT']), remarks: z.string().trim().optional() })
  .refine((d) => d.decision === 'APPROVE' || (d.remarks?.length ?? 0) >= 3, { message: 'Give the reason for refusing', path: ['remarks'] });

export const emergencyPurchaseSchema = z.object({
  requisitionId: objectId,
  vendorId: objectId,
  /** Unit price per PR line id */
  prices: z.record(objectId, z.number().nonnegative()),
  taxRate: gstRate.default(18),
  deliveryDays: z.number().int().nonnegative().default(1),
  justification: z.string().trim().min(10, 'Explain the emergency in at least 10 characters'),
});
