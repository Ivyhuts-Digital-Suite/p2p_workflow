import { Router } from 'express';
import { INTERNAL_ROLES, ROLES } from '../../constants/roles';
import { authenticate, authorize } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as ctrl from './admin.controller';
import {
  createUserSchema,
  departmentSchema,
  doaRuleSchema,
  updateDepartmentSchema,
  updateDoaRuleSchema,
  updateUserSchema,
} from './admin.validation';

const router = Router();
router.use(authenticate);

router.get('/users', authorize(ROLES.ADMIN), ctrl.listUsers);
router.post('/users', authorize(ROLES.ADMIN), validate(createUserSchema), ctrl.createUser);
router.patch('/users/:id', authorize(ROLES.ADMIN), validate(updateUserSchema), ctrl.updateUser);

router.get('/departments', authorize(...INTERNAL_ROLES), ctrl.listDepartments);
router.post('/departments', authorize(ROLES.ADMIN), validate(departmentSchema), ctrl.createDepartment);
router.patch('/departments/:id', authorize(ROLES.ADMIN, ROLES.FINANCE), validate(updateDepartmentSchema), ctrl.updateDepartment);

router.get('/doa-rules', authorize(...INTERNAL_ROLES), ctrl.listDoaRules);
router.post('/doa-rules', authorize(ROLES.ADMIN, ROLES.FINANCE), validate(doaRuleSchema), ctrl.createDoaRule);
router.patch('/doa-rules/:id', authorize(ROLES.ADMIN, ROLES.FINANCE), validate(updateDoaRuleSchema), ctrl.updateDoaRule);

export default router;
