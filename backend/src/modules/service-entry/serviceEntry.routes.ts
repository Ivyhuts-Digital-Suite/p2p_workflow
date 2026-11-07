import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from '../../constants/roles';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as ctrl from './serviceEntry.controller';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

const createSchema = z.object({
  purchaseOrderId: objectId,
  poItemId: objectId,
  quantity: z.number().positive(),
  completedOn: z.coerce.date().refine((d) => d <= new Date(), 'The completion date cannot be in the future'),
  remarks: z.string().trim().optional(),
});
const acceptSchema = z.object({ remarks: z.string().trim().optional() });
const rejectSchema = z.object({ remarks: z.string().trim().min(3, 'Give the reason for rejecting this sign-off') });

const router = Router();
router.use(authenticate);

router.get('/', authorize(ROLES.REQUESTER, ROLES.HOD, ROLES.STORE, ROLES.PROCUREMENT, ROLES.FINANCE, ROLES.VENDOR), ctrl.listServiceEntries);
router.post('/', authorize(ROLES.REQUESTER, ROLES.HOD, ROLES.STORE, ROLES.PROCUREMENT), validate(createSchema), ctrl.createServiceEntry);
router.post('/:id/accept', authorize(ROLES.HOD), validate(acceptSchema), ctrl.acceptServiceEntry);
router.post('/:id/reject', authorize(ROLES.HOD), validate(rejectSchema), ctrl.rejectServiceEntry);

export default router;
