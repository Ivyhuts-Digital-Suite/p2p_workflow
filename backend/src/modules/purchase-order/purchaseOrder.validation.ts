import { z } from 'zod';
import { GST_SLABS } from '../../constants/status';

export const createPoSchema = z.object({
  /** Overrides the GST the vendor quoted, on every line unless overridden per RFQ item */
  taxRate: z
    .number()
    .refine((r) => GST_SLABS.includes(r), `GST rate must be one of ${GST_SLABS.join(', ')}`)
    .optional(),
  lineTaxRates: z.record(z.string(), z.number().refine((r) => GST_SLABS.includes(r))).optional(),
  deliveryAddress: z.string().optional(),
  expectedDeliveryDate: z.coerce.date().optional(),
  paymentTerms: z.string().default('Net 30'),
});

export const approvalActionSchema = z.object({ remarks: z.string().optional() });
export const rejectionSchema = z.object({ remarks: z.string().min(3) });
export const cancelSchema = z.object({ reason: z.string().min(3) });
