import { Router } from 'express';
import { ROLES } from '../../constants/roles';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as ctrl from './requisition.controller';
import { createPrSchema, messageSchema, ratifySchema, reasonSchema, remarksSchema, requiredRemarksSchema, updatePrSchema } from './requisition.validation';

const router = Router();
router.use(authenticate);

const viewers = authorize(ROLES.REQUESTER, ROLES.HOD, ROLES.PROCUREMENT, ROLES.FINANCE);
const requester = authorize(ROLES.REQUESTER);
// A PR DoA rule may add these roles after the HOD; the controller enforces the exact step.
const approvers = authorize(ROLES.HOD, ROLES.FINANCE, ROLES.PROCUREMENT);

router.get('/', viewers, ctrl.listRequisitions);
router.get('/:id', viewers, ctrl.getRequisition);
router.post('/', requester, validate(createPrSchema), ctrl.createRequisition);
router.patch('/:id', requester, validate(updatePrSchema), ctrl.updateRequisition);
router.get('/:id/journey', viewers, ctrl.requisitionJourney);
router.get('/:id/messages', viewers, ctrl.listMessages);
router.post('/:id/messages', viewers, validate(messageSchema), ctrl.postMessage);
router.post('/:id/submit', requester, ctrl.submitRequisition);

// Department HOD / Admin actions
router.post('/:id/approve', approvers, validate(remarksSchema), ctrl.approveRequisition);
router.post('/:id/reject', approvers, validate(requiredRemarksSchema), ctrl.rejectRequisition);
router.post('/:id/ratify', authorize(ROLES.FINANCE), validate(ratifySchema), ctrl.ratifyEmergency);
router.post('/:id/cancel', authorize(ROLES.HOD, ROLES.REQUESTER), validate(reasonSchema), ctrl.cancelRequisition);
router.post('/:id/deactivate', authorize(ROLES.HOD), validate(reasonSchema), ctrl.deactivateRequisition);
router.post('/:id/reactivate', authorize(ROLES.HOD), ctrl.reactivateRequisition);

export default router;
