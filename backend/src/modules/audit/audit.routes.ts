import { Router } from 'express';
import { ROLES } from '../../constants/roles';
import { authenticate, authorize } from '../../middleware/auth';
import * as ctrl from './audit.controller';

const router = Router();
router.use(authenticate, authorize(ROLES.AUDITOR));

// Read-only by design: the audit trail has no create, update or delete route.
router.get('/activity', ctrl.activity);
router.get('/matching', ctrl.matchingLogs);
router.get('/compliance', ctrl.compliance);
router.get('/awards', ctrl.awards);

export default router;
