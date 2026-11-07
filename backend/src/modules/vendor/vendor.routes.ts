import { Router } from 'express';
import { ROLES } from '../../constants/roles';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as ctrl from './vendor.controller';
import { createVendorSchema, updateVendorSchema, vendorDocumentSchema, vendorSelfUpdateSchema, verifyDocumentSchema } from './vendor.validation';

const router = Router();
router.use(authenticate);

// Vendor self-service (must precede /:id)
router.get('/me', authorize(ROLES.VENDOR), ctrl.myProfile);
router.patch('/me', authorize(ROLES.VENDOR), validate(vendorSelfUpdateSchema), ctrl.updateMyProfile);
router.post('/me/documents', authorize(ROLES.VENDOR), validate(vendorDocumentSchema), ctrl.addMyDocument);

// Vendor master - procurement
const buyers = authorize(ROLES.PROCUREMENT, ROLES.FINANCE);
router.get('/', buyers, ctrl.listVendors);
router.get('/:id', buyers, ctrl.getVendor);
router.post('/', authorize(ROLES.PROCUREMENT), validate(createVendorSchema), ctrl.createVendor);
router.patch('/:id', authorize(ROLES.PROCUREMENT), validate(updateVendorSchema), ctrl.updateVendor);
router.post('/:id/approve', authorize(ROLES.PROCUREMENT), ctrl.approveVendor);
router.post('/:id/suspend', authorize(ROLES.PROCUREMENT), ctrl.suspendVendor);
router.post('/:id/blacklist', authorize(ROLES.PROCUREMENT), ctrl.blacklistVendor);
router.post('/:id/documents/:docId/verify', authorize(ROLES.PROCUREMENT), validate(verifyDocumentSchema), ctrl.verifyDocument);

export default router;
