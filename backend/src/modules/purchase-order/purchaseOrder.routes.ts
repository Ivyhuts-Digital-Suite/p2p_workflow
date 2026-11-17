import { Router } from 'express';
import { ROLES } from '../../constants/roles';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as ctrl from './purchaseOrder.controller';
import { approvalActionSchema, cancelSchema, createPoSchema, rejectionSchema } from './purchaseOrder.validation';

const router = Router();
router.use(authenticate);

const procurement = authorize(ROLES.PROCUREMENT);
// Any role may appear in a DoA chain; the DoA service enforces the exact step role.
const approvers = authorize(ROLES.PROCUREMENT, ROLES.HOD, ROLES.FINANCE);

router.get('/', ctrl.listPurchaseOrders);
router.get('/summary', ctrl.purchaseOrderSummary);
router.get('/invoiceable', authorize(ROLES.VENDOR, ROLES.FINANCE), ctrl.listInvoiceablePurchaseOrders);
router.get('/:id', ctrl.getPurchaseOrder);
router.post('/from-bid/:bidId', procurement, validate(createPoSchema), ctrl.createFromBid);
router.post('/:id/approve', approvers, validate(approvalActionSchema), ctrl.approvePurchaseOrder);
router.post('/:id/reject', approvers, validate(rejectionSchema), ctrl.rejectPurchaseOrder);
router.post('/:id/issue', procurement, ctrl.issuePurchaseOrder);
router.post('/:id/cancel', procurement, validate(cancelSchema), ctrl.cancelPurchaseOrder);

export default router;
