import { Request, RequestHandler } from 'express';
import { ROLES, Role } from '../constants/roles';
import { User } from '../models/User';
import { AuthUser } from '../types/auth';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { verifyToken } from '../utils/jwt';

const READ_METHODS = ['GET', 'HEAD'];

/**
 * Verifies the bearer token and attaches the (still active) user to req.user.
 * Auditors are stopped here on any write, so no route can grant them one by accident.
 */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw ApiError.unauthorized('Missing bearer token');
  }

  const payload = verifyToken(header.slice(7));
  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) {
    throw ApiError.unauthorized('Account not found or deactivated');
  }

  req.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department?.toString(),
    vendor: user.vendor?.toString(),
    doaLimit: user.doaLimit,
  };
  if (
    user.role === ROLES.AUDITOR &&
    !READ_METHODS.includes(req.method) &&
    !req.originalUrl.startsWith('/api/auth/')
  ) {
    throw ApiError.forbidden('Auditors have read-only access and cannot approve, change or release anything');
  }
  next();
});

/** Restricts a route to the given roles. ADMIN always passes; AUDITOR passes on reads only. */
export const authorize =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    const auditorRead = req.user.role === ROLES.AUDITOR && READ_METHODS.includes(req.method);
    if (req.user.role !== ROLES.ADMIN && !auditorRead && !roles.includes(req.user.role)) {
      return next(ApiError.forbidden(`Requires one of roles: ${roles.join(', ')}`));
    }
    next();
  };

/** Returns the authenticated user or throws - use inside handlers behind `authenticate`. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}
