import { Router } from 'express';
import { ROLES } from '../../constants/roles';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as ctrl from './invoice.controller';
import { adjustmentNoteSchema, bookLiabilitySchema, exceptionDecisionSchema, rejectInvoiceSchema, submitInvoiceSchema } from './invoice.validation';

const router = Router();
router.use(authenticate);

const finance = authorize(ROLES.FINANCE);
const viewers = authorize(ROLES.FINANCE, ROLES.VENDOR);

router.get('/', viewers, ctrl.listInvoices);
router.get('/:id', viewers, ctrl.getInvoice);
router.post('/', authorize(ROLES.VENDOR, ROLES.FINANCE), validate(submitInvoiceSchema), ctrl.submitInvoice);
router.post('/:id/match', finance, ctrl.matchInvoice);
router.post('/:id/book', finance, validate(bookLiabilitySchema), ctrl.bookLiability);
router.post('/:id/reject', finance, validate(rejectInvoiceSchema), ctrl.rejectInvoice);
router.post('/:id/exception-decision', finance, validate(exceptionDecisionSchema), ctrl.decideException);
router.post('/:id/debit-notes', finance, validate(adjustmentNoteSchema), ctrl.addDebitNote);
router.post('/:id/credit-notes', finance, validate(adjustmentNoteSchema), ctrl.addCreditNote);

export default router;
