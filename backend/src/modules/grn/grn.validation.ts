import { z } from 'zod';
import { GRN_QUALITY_STATUS, enumValues } from '../../constants/status';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const qualityStatuses = enumValues(GRN_QUALITY_STATUS) as [string, ...string[]];

export const createGrnSchema = z
  .object({
    purchaseOrderId: objectId,
    warehouse: z.string().min(2),
    deliveryNoteNumber: z.string().trim().min(1, 'Invoice / challan number is required'),
    physicalCheck: z.object({
      boxesExpected: z.number().int().nonnegative(),
      boxesCounted: z.number().int().nonnegative(),
    }),
    qcRemarks: z.string().trim().optional(),
    /** Optional photos of the delivery: JPEG, PNG or WebP data URLs */
    photos: z.array(z.string().regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, 'A photo must be a JPEG, PNG or WebP image')).default([]),
    items: z
      .array(
        z
          .object({
            poItemId: objectId,
            receivedQty: z.number().nonnegative(),
            acceptedQty: z.number().nonnegative(),
            qualityStatus: z.enum(qualityStatuses),
            rejectionReason: z.string().trim().optional(),
            shortageReason: z.string().trim().optional(),
            batchNumber: z.string().trim().min(1).optional(),
            expiryDate: z.coerce.date().optional(),
            serialNumbers: z.array(z.string().trim().min(1)).default([]),
          })
          .refine((l) => l.acceptedQty <= l.receivedQty, { message: 'acceptedQty cannot exceed receivedQty' })
          .refine((l) => l.acceptedQty === l.receivedQty || !!l.rejectionReason, {
            message: 'rejectionReason is required when goods are rejected',
          })
          .refine((l) => (l.qualityStatus === GRN_QUALITY_STATUS.PASSED) === (l.acceptedQty === l.receivedQty), {
            message: 'Lines with rejected goods must be marked damaged or quality failed, and only those lines',
          }),
      )
      .min(1),
  })
  .refine((g) => g.physicalCheck.boxesExpected === g.physicalCheck.boxesCounted || !!g.qcRemarks, {
    message: 'Explain the box count mismatch in the inspection remarks',
    path: ['qcRemarks'],
  });

export const createReturnSchema = z.object({
  grnLineId: objectId,
  quantity: z.number().positive(),
  reason: z.string().trim().min(3),
  resolution: z.enum(['REPLACE', 'CREDIT']),
});

export const dispatchReturnSchema = z.object({ carrierReference: z.string().trim().min(1, 'Enter the carrier or dispatch reference') });
