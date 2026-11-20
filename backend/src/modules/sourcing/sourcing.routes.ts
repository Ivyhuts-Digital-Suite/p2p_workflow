import { Router } from 'express';
import { ROLES } from '../../constants/roles';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as ctrl from './sourcing.controller';
import {
  awardSchema,
  budgetEscalationSchema,
  createRfqSchema,
  emergencyPurchaseSchema,
  escalationDecisionSchema,
  qualityScoreSchema,
  submitBidSchema,
} from './sourcing.validation';

const router = Router();
router.use(authenticate);

const procurement = authorize(ROLES.PROCUREMENT);
const vendor = authorize(ROLES.VENDOR);

router.get('/dashboard', procurement, ctrl.biddingDashboard);

router.get('/rfqs', authorize(ROLES.PROCUREMENT, ROLES.VENDOR), ctrl.listRfqs);
router.post('/rfqs', procurement, validate(createRfqSchema), ctrl.createRfq);
router.get('/rfqs/:id', authorize(ROLES.PROCUREMENT, ROLES.VENDOR), ctrl.getRfq);
router.post('/rfqs/:id/publish', procurement, ctrl.publishRfq);
router.post('/rfqs/:id/close', procurement, ctrl.closeRfq);
router.post('/rfqs/:id/cancel', procurement, ctrl.cancelRfq);
router.post('/rfqs/:id/award', procurement, validate(awardSchema), ctrl.awardRfq);
router.post('/rfqs/:id/budget-escalation', procurement, validate(budgetEscalationSchema), ctrl.requestBudgetEscalation);
router.post('/rfqs/:id/budget-escalation/decision', authorize(ROLES.FINANCE), validate(escalationDecisionSchema), ctrl.decideBudgetEscalation);
router.post('/emergency-purchases', procurement, validate(emergencyPurchaseSchema), ctrl.emergencyPurchase);

router.get('/rfqs/:id/bids', authorize(ROLES.PROCUREMENT, ROLES.VENDOR), ctrl.listRfqBids);
router.post('/rfqs/:id/bids', vendor, validate(submitBidSchema), ctrl.submitBid);
router.post('/bids/:bidId/withdraw', vendor, ctrl.withdrawBid);
router.patch('/bids/:bidId/quality-score', procurement, validate(qualityScoreSchema), ctrl.setQualityScore);

export default router;
