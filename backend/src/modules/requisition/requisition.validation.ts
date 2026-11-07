import { z } from 'zod';
import { ITEM_TYPE, PR_PRIORITY, enumValues } from '../../constants/status';

const prItem = z.object({
  itemCode: z.string().optional(),
  description: z.string().min(1),
  category: z.string().optional(),
  quantity: z.number().positive(),
  uom: z.string().default('EA'),
  estimatedUnitPrice: z.number().nonnegative(),
  itemType: z.enum(enumValues(ITEM_TYPE) as [string, ...string[]]).default(ITEM_TYPE.GOODS),
});

const priorities = enumValues(PR_PRIORITY) as [string, ...string[]];

export const createPrSchema = z
  .object({
    title: z.string().min(3),
    /** Decides whose HOD approves the PR and whose budget it draws on */
    department: z.string({ required_error: 'Select a department' }).regex(/^[a-f\d]{24}$/i, 'Select a department'),
    justification: z.string().optional(),
    neededBy: z.coerce.date().optional(),
    priority: z.enum(priorities).default(PR_PRIORITY.MEDIUM),
    items: z.array(prItem).min(1),
    isEmergency: z.boolean().default(false),
    emergencyReason: z.string().trim().optional(),
  })
  .refine((pr) => !pr.isEmergency || (pr.emergencyReason?.length ?? 0) >= 10, {
    message: 'Explain the emergency in at least 10 characters',
    path: ['emergencyReason'],
  });

export const updatePrSchema = z
  .object({
    title: z.string().min(3),
    department: z.string().regex(/^[a-f\d]{24}$/i, 'Select a department'),
    justification: z.string(),
    neededBy: z.coerce.date(),
    priority: z.enum(priorities),
    items: z.array(prItem).min(1),
  })
  .partial();

export const messageSchema = z.object({ text: z.string().trim().min(1, 'Write a message').max(1000) });

export const ratifySchema = z
  .object({ decision: z.enum(['RATIFY', 'REJECT']), remarks: z.string().trim().optional() })
  .refine((r) => r.decision === 'RATIFY' || (r.remarks?.length ?? 0) >= 3, { message: 'Give the reason for refusing', path: ['remarks'] });

export const remarksSchema = z.object({ remarks: z.string().optional() });
export const requiredRemarksSchema = z.object({ remarks: z.string().min(3) });
export const reasonSchema = z.object({ reason: z.string().min(3) });
