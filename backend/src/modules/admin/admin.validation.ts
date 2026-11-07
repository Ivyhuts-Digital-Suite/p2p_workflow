import { z } from 'zod';
import { ALL_ROLES, DEPARTMENT_ROLES, ROLES, Role } from '../../constants/roles';
import { DOA_DOCUMENT_TYPES } from '../../models/DoaRule';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const role = z.enum(ALL_ROLES as [Role, ...Role[]]);

export const createUserSchema = z
  .object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(8),
    role,
    department: objectId.optional(),
    vendor: objectId.optional(),
    doaLimit: z.number().nonnegative().default(0),
  })
  .refine((u) => !DEPARTMENT_ROLES.includes(u.role) || !!u.department, {
    message: 'Select a department for this role',
    path: ['department'],
  });

export const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  role: role.optional(),
  department: objectId.nullable().optional(),
  doaLimit: z.number().nonnegative().optional(),
  isActive: z.boolean().optional(),
});

export const departmentSchema = z.object({
  name: z.string().min(2),
  code: z.string().min(2).max(10),
  costCenter: z.string().optional(),
  hod: objectId.optional(),
  budget: z.object({
    fiscalYear: z.string().min(4),
    allocated: z.number().nonnegative(),
  }),
});

export const updateDepartmentSchema = z.object({
  name: z.string().min(2).optional(),
  costCenter: z.string().optional(),
  hod: objectId.nullable().optional(),
  isActive: z.boolean().optional(),
  budget: z.object({ fiscalYear: z.string().min(4).optional(), allocated: z.number().nonnegative().optional() }).optional(),
});

/**
 * Only roles who can reach that document's approval screen, and who are independent of it. Finance
 * verifies and releases every payment, so a payment chain is the check on Finance and can't include it.
 */
const ALLOWED_APPROVERS: Record<string, Role[]> = {
  PR: [ROLES.HOD, ROLES.FINANCE, ROLES.PROCUREMENT, ROLES.ADMIN],
  PAYMENT: [ROLES.HOD, ROLES.ADMIN],
};
export const approversAllowed = (r: { documentType?: string; levels?: { role: Role }[] }) => {
  const allowed = ALLOWED_APPROVERS[r.documentType ?? 'PO'];
  return !allowed || !r.levels || r.levels.every((l) => allowed.includes(l.role));
};
export const approversMessage = {
  message: 'A PR chain can use HOD, Finance, Procurement and Admin. A payment chain can use HOD and Admin.',
  path: ['levels'],
};

const doaRuleFields = z.object({
  name: z.string().min(2),
  documentType: z.enum(DOA_DOCUMENT_TYPES).default('PO'),
  minAmount: z.number().nonnegative(),
  maxAmount: z.number().positive().nullable().default(null),
  levels: z.array(z.object({ level: z.number().int().positive(), role })).min(1),
  isActive: z.boolean().default(true),
});

export const updateDoaRuleSchema = z.object({
  name: doaRuleFields.shape.name.optional(),
  minAmount: doaRuleFields.shape.minAmount.optional(),
  maxAmount: z.number().positive().nullable().optional(),
  levels: doaRuleFields.shape.levels.optional(),
  isActive: z.boolean().optional(),
});

export const doaRuleSchema = doaRuleFields
  .refine((r) => r.maxAmount === null || r.maxAmount > r.minAmount, {
    message: 'maxAmount must exceed minAmount',
    path: ['maxAmount'],
  })
  .refine(approversAllowed, approversMessage);
