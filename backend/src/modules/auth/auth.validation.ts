import { z } from 'zod';
import { DEPARTMENT_ROLES, INTERNAL_ROLES, Role } from '../../constants/roles';
import { GSTIN_REGEX, PAN_REGEX } from '../../services/tax.service';

const internalRole = z.enum(INTERNAL_ROLES as [Role, ...Role[]]);

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  /** Roles of the role card selected on the login page; the account must hold one of them */
  roles: z.array(z.string()).optional(),
});

export const registerVendorSchema = z
  .object({
    companyName: z.string().trim().min(2, 'Company name is required'),
    contactPerson: z.string().trim().min(2, 'Contact person is required'),
    email: z.string().trim().toLowerCase().email('Enter a valid email'),
    phone: z.string().trim().regex(/^\+?[\d\s-]{8,15}$/, 'Enter a valid phone number'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    gstin: z.string().trim().toUpperCase().regex(GSTIN_REGEX, 'Invalid GSTIN format (e.g. 27AABCU9603R1ZM)'),
    pan: z.string().trim().toUpperCase().regex(PAN_REGEX, 'Invalid PAN format (e.g. AABCU9603R)'),
    categories: z.array(z.string().trim().min(1)).default([]),
  })
  .refine((v) => v.gstin.slice(2, 12) === v.pan, {
    message: 'The PAN must match the PAN embedded in the GSTIN',
    path: ['pan'],
  });

export const registerInternalSchema = z
  .object({
    role: internalRole,
    name: z.string().trim().min(2, 'Full name is required'),
    email: z.string().trim().toLowerCase().email('Enter a valid email'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    department: z.string().regex(/^[a-f\d]{24}$/i, 'Select a department').optional(),
    registrationCode: z.string().optional(),
  })
  .refine((v) => !DEPARTMENT_ROLES.includes(v.role) || !!v.department, {
    message: 'Select a department',
    path: ['department'],
  });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});
