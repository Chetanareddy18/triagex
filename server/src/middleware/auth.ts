import type { NextFunction, Request, Response } from 'express';
import type { Role } from '../lib/domain.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { verifyAccessToken } from '../services/auth.js';
import type { RequestUser } from '../services/incidents.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: RequestUser;
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) return next(unauthorized());
  const claims = verifyAccessToken(token);
  req.user = { id: claims.sub, role: claims.role, name: claims.name, email: claims.email };
  next();
}

/** RBAC guard: `requireRole('admin')`, `requireRole('agent', 'admin')`. */
export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };

export const staffOnly = requireRole('agent', 'admin');
export const adminOnly = requireRole('admin');

export function currentUser(req: Request): RequestUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
