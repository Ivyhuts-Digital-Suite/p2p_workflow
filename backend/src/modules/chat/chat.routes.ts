import { Router } from 'express';
import { ROLES } from '../../constants/roles';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { messageSchema } from '../requisition/requisition.validation';
import * as ctrl from './chat.controller';

const router = Router();
router.use(authenticate);

// The PR conversations themselves stay under /requisitions/:id/messages.
// Vendor conversations: the vendor, and Procurement (Admin passes; the Auditor reads only).
const vendorSide = authorize(ROLES.VENDOR);
const buyerSide = authorize(ROLES.PROCUREMENT);

/** Every signed-in role: the unread badge on each of their journey cards */
router.get('/unread', ctrl.unreadCounts);
router.get('/rfqs/:rfqId/vendors', buyerSide, ctrl.listVendorThreads);
router.get('/rfqs/:rfqId/vendors/:vendorId/messages', buyerSide, ctrl.listVendorMessages);
router.post('/rfqs/:rfqId/vendors/:vendorId/messages', buyerSide, validate(messageSchema), ctrl.postVendorMessage);
router.get('/rfqs/:rfqId/messages', vendorSide, ctrl.listVendorMessages);
router.post('/rfqs/:rfqId/messages', vendorSide, validate(messageSchema), ctrl.postVendorMessage);

export default router;
