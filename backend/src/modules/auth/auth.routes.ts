import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as ctrl from './auth.controller';
import { changePasswordSchema, loginSchema, registerInternalSchema, registerVendorSchema } from './auth.validation';

const router = Router();

router.post('/login', validate(loginSchema), ctrl.login);
router.get('/signup-options', ctrl.signupOptions);
router.post('/register-vendor', validate(registerVendorSchema), ctrl.registerVendor);
router.post('/register-internal', validate(registerInternalSchema), ctrl.registerInternal);
router.get('/me', authenticate, ctrl.me);
router.post('/change-password', authenticate, validate(changePasswordSchema), ctrl.changePassword);

export default router;
