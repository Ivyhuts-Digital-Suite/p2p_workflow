import { Router } from 'express';
import { ROLES } from '../../constants/roles';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as ctrl from './treasury.controller';
import { paymentDecisionSchema, paymentRejectionSchema, releasePaymentSchema, verifyTaxSchema, webhookSchema } from './treasury.validation';

const router = Router();

// The bank calls this with a signature instead of a session, so it stays ahead of authenticate.
router.post('/payments/webhook', validate(webhookSchema), ctrl.bankWebhook);

router.use(authenticate);

// Finance handles the whole of invoice processing and payment. The API path stays /treasury.
router.get('/queue', authorize(ROLES.FINANCE), ctrl.treasuryQueue);
router.post('/invoices/:id/verify-tax', authorize(ROLES.FINANCE), validate(verifyTaxSchema), ctrl.verifyInvoiceTax);
router.get('/payments', authorize(ROLES.FINANCE, ROLES.VENDOR), ctrl.listPayments);
router.get('/payments/my-approvals', authorize(ROLES.HOD, ROLES.FINANCE), ctrl.myPaymentApprovals);
router.post('/payments/:id/approve', authorize(ROLES.HOD), validate(paymentDecisionSchema), ctrl.approvePayment);
router.post('/payments/:id/reject', authorize(ROLES.HOD), validate(paymentRejectionSchema), ctrl.rejectPayment);
router.post('/payments/:id/release', authorize(ROLES.FINANCE), validate(releasePaymentSchema), ctrl.releasePayment);
router.post('/payments/:id/retry', authorize(ROLES.FINANCE), validate(releasePaymentSchema), ctrl.retryPayment);
router.post('/payments/:id/check-status', authorize(ROLES.FINANCE), ctrl.checkPaymentStatus);

export default router;
