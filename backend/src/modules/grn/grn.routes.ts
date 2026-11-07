import { Router } from 'express';
import { ROLES } from '../../constants/roles';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as ctrl from './grn.controller';
import { createGrnSchema, createReturnSchema, dispatchReturnSchema } from './grn.validation';

const router = Router();
router.use(authenticate);

const store = authorize(ROLES.STORE);
const stockViewers = authorize(ROLES.STORE, ROLES.PROCUREMENT);

// Fixed paths first: they must not be read as a GRN id.
router.get('/inventory', stockViewers, ctrl.listInventory);
router.get('/inventory/near-expiry', stockViewers, ctrl.nearExpiryReport);
router.get('/returns', authorize(ROLES.STORE, ROLES.PROCUREMENT, ROLES.FINANCE, ROLES.VENDOR), ctrl.listReturns);
router.post('/returns/:id/dispatch', store, validate(dispatchReturnSchema), ctrl.dispatchReturn);
router.get('/', authorize(ROLES.STORE, ROLES.PROCUREMENT, ROLES.FINANCE, ROLES.VENDOR), ctrl.listGrns);
router.get('/:id', authorize(ROLES.STORE, ROLES.PROCUREMENT, ROLES.FINANCE, ROLES.VENDOR), ctrl.getGrn);
router.post('/', store, validate(createGrnSchema), ctrl.createGrn);
router.post('/:id/returns', store, validate(createReturnSchema), ctrl.createReturn);

export default router;
