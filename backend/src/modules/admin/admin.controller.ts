import { DEPARTMENT_ROLES } from '../../constants/roles';
import { currentUser } from '../../middleware/auth';
import { Department } from '../../models/Department';
import { DoaRule } from '../../models/DoaRule';
import { User } from '../../models/User';
import { ApiError } from '../../utils/ApiError';
import { asyncHandler } from '../../utils/asyncHandler';
import { approversAllowed, approversMessage } from './admin.validation';

// ---- Users ---------------------------------------------------------------------

export const listUsers = asyncHandler(async (req, res) => {
  const filter = req.query.role ? { role: String(req.query.role) } : {};
  const users = await User.find(filter).populate('department', 'name code').sort({ name: 1 });
  res.json(users);
});

export const createUser = asyncHandler(async (req, res) => {
  const user = await User.create(req.body);
  res.status(201).json(user);
});

export const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User');
  if (user.id === currentUser(req).id && (req.body.isActive === false || (req.body.role && req.body.role !== user.role))) {
    throw ApiError.unprocessable('You cannot deactivate your own account or change your own role');
  }

  user.set(req.body);
  if (DEPARTMENT_ROLES.includes(user.role) && !user.department) {
    throw ApiError.unprocessable('Select a department for this role');
  }
  await user.save();
  await user.populate('department', 'name code');
  res.json(user);
});

// ---- Departments & budgets -------------------------------------------------------

export const listDepartments = asyncHandler(async (_req, res) => {
  res.json(await Department.find().populate('hod', 'name email').sort({ name: 1 }));
});

export const createDepartment = asyncHandler(async (req, res) => {
  res.status(201).json(await Department.create(req.body));
});

export const updateDepartment = asyncHandler(async (req, res) => {
  const dept = await Department.findById(req.params.id);
  if (!dept) throw ApiError.notFound('Department');

  const { budget, ...rest } = req.body;
  dept.set(rest);
  if (budget?.allocated !== undefined) {
    if (budget.allocated < dept.budget.committed) {
      throw ApiError.unprocessable('Allocated budget cannot be lower than the amount already committed');
    }
    dept.budget.allocated = budget.allocated;
  }
  if (budget?.fiscalYear) dept.budget.fiscalYear = budget.fiscalYear;
  await dept.save();
  res.json(dept);
});

// ---- Delegation of Authority rules -----------------------------------------------

export const listDoaRules = asyncHandler(async (_req, res) => {
  res.json(await DoaRule.find().sort({ minAmount: 1 }));
});

export const createDoaRule = asyncHandler(async (req, res) => {
  res.status(201).json(await DoaRule.create(req.body));
});

export const updateDoaRule = asyncHandler(async (req, res) => {
  const existing = await DoaRule.findById(req.params.id);
  if (!existing) throw ApiError.notFound('DoA rule');
  if (!approversAllowed({ documentType: existing.documentType, levels: req.body.levels })) {
    throw ApiError.unprocessable(approversMessage.message);
  }
  const rule = await DoaRule.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  res.json(rule);
});
