import { env } from '../../config/env';
import { currentUser } from '../../middleware/auth';
import { Department } from '../../models/Department';
import { User } from '../../models/User';
import { Vendor } from '../../models/Vendor';
import { MASTER_ROLES, ROLES, Role } from '../../constants/roles';
import { ApiError } from '../../utils/ApiError';
import { asyncHandler } from '../../utils/asyncHandler';
import { signToken } from '../../utils/jwt';
import { nextDocNumber } from '../../utils/sequence';

export const login = asyncHandler(async (req, res) => {
  const { email, password, roles } = req.body;
  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    throw ApiError.unauthorized('Invalid email or password');
  }
  if (!user.isActive) throw ApiError.unauthorized('Account is inactive or awaiting administrator activation');
  // Checked after the password so the selected card cannot be used to probe which role an email holds.
  if (roles && !roles.includes(user.role)) {
    throw ApiError.forbidden('This account does not belong to the selected role');
  }

  user.lastLoginAt = new Date();
  await user.save();

  const token = signToken({ sub: user.id, role: user.role });
  const profile = await User.findById(user._id).populate('department', 'name code').populate('vendor', 'companyName vendorCode status');
  res.json({ token, user: profile });
});

/** Self-service vendor onboarding: creates a PENDING vendor and its portal account. */
export const registerVendor = asyncHandler(async (req, res) => {
  const { password, ...profile } = req.body;
  if (await User.exists({ email: profile.email.toLowerCase() })) {
    throw ApiError.conflict('An account with this email already exists');
  }
  if (profile.gstin && (await Vendor.exists({ gstin: profile.gstin }))) {
    throw ApiError.conflict('A vendor with this GSTIN is already registered');
  }

  const vendor = await Vendor.create({ ...profile, vendorCode: await nextDocNumber('VEN') });
  try {
    const user = await User.create({
      name: profile.contactPerson,
      email: profile.email,
      password,
      role: ROLES.VENDOR,
      vendor: vendor._id,
    });
    vendor.user = user._id;
    await vendor.save();

    // Sign the vendor straight in; bidding stays locked until procurement approves the profile.
    const token = signToken({ sub: user.id, role: user.role });
    const profileWithVendor = await User.findById(user._id).populate('vendor', 'companyName vendorCode status');
    res.status(201).json({
      message: 'Registration received. Bidding is enabled once procurement approves your profile.',
      token,
      user: profileWithVendor,
    });
  } catch (err) {
    await vendor.deleteOne();
    throw err;
  }
});

/** What the sign-up page needs: which master accounts are taken, and the departments to join. */
export const signupOptions = asyncHandler(async (_req, res) => {
  const [claimedRoles, departments, hods] = await Promise.all([
    User.distinct('role', { role: { $in: MASTER_ROLES } }),
    // Read live on every request, so a department an Admin adds is offered immediately.
    Department.find({ isActive: { $ne: false } }).select('name code').sort({ name: 1 }).lean(),
    User.distinct('department', { role: ROLES.HOD }),
  ]);
  const hodDepartments = hods.map(String);
  res.json({
    claimedRoles,
    departments: departments.map((d) => ({ ...d, hodClaimed: hodDepartments.includes(d._id.toString()) })),
    internalSignupEnabled: !env.isProduction || !!env.internalSignupCode,
    registrationCodeRequired: !!env.internalSignupCode,
  });
});

function assertInternalSignupAllowed(registrationCode?: string) {
  if (env.isProduction && !env.internalSignupCode) {
    throw ApiError.forbidden('Internal self sign-up is disabled; ask your administrator for an account');
  }
  if (env.internalSignupCode && registrationCode !== env.internalSignupCode) {
    throw ApiError.forbidden('Invalid registration code');
  }
}

/**
 * Self-service sign-up for internal roles under the Single Master Account Policy.
 * The first Admin is active immediately (someone has to be able to activate the rest);
 * every other internal account waits for an Admin to activate it, so that signing up
 * cannot by itself grant access to company data.
 */
export const registerInternal = asyncHandler(async (req, res) => {
  const { registrationCode, ...fields } = req.body;
  const role = fields.role as Role;
  assertInternalSignupAllowed(registrationCode);

  if (await User.exists({ email: fields.email })) {
    throw ApiError.conflict('An account with this email already exists');
  }
  if (MASTER_ROLES.includes(role) && (await User.exists({ role }))) {
    throw ApiError.conflict('Single Master Account Policy: an account already exists for this role');
  }
  if (fields.department && !(await Department.exists({ _id: fields.department, isActive: { $ne: false } }))) {
    throw ApiError.unprocessable('Department not found');
  }
  if (role === ROLES.HOD && (await User.exists({ role, department: fields.department }))) {
    throw ApiError.conflict('Single Master Account Policy: this department already has a Head of Department');
  }

  const isFirstAdmin = role === ROLES.ADMIN;
  const user = await User.create({
    ...fields,
    isActive: isFirstAdmin,
    doaLimit: isFirstAdmin ? Number.MAX_SAFE_INTEGER : 0,
  });
  if (role === ROLES.HOD) await Department.updateOne({ _id: fields.department }, { hod: user._id });

  if (!isFirstAdmin) {
    return res.status(201).json({ message: 'Account created. An administrator must activate it before you can sign in.' });
  }
  res.status(201).json({
    message: 'Administrator account created.',
    token: signToken({ sub: user.id, role: user.role }),
    user,
  });
});

export const me = asyncHandler(async (req, res) => {
  const user = await User.findById(currentUser(req).id)
    .populate('department', 'name code')
    .populate('vendor', 'companyName vendorCode status');
  res.json(user);
});

export const changePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(currentUser(req).id).select('+password');
  if (!user || !(await user.comparePassword(req.body.currentPassword))) {
    throw ApiError.badRequest('Current password is incorrect');
  }
  user.password = req.body.newPassword;
  await user.save();
  res.json({ message: 'Password updated' });
});
