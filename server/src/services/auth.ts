import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import type { Role } from '../lib/domain.js';
import { unauthorized } from '../lib/errors.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { User, type IUser } from '../models/User.js';
import { recordAudit } from './audit.js';

const BCRYPT_ROUNDS = env.NODE_ENV === 'test' ? 4 : 11;

export interface AccessClaims {
  sub: string;
  role: Role;
  name: string;
  email: string;
}

export const hashPassword = (plain: string) => bcrypt.hash(plain, BCRYPT_ROUNDS);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

export function signAccessToken(user: Pick<IUser, '_id' | 'role' | 'name' | 'email'>): string {
  const claims: AccessClaims = { sub: String(user._id), role: user.role, name: user.name, email: user.email };
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL_SECONDS, issuer: 'triagex' });
}

export function verifyAccessToken(token: string): AccessClaims {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: 'triagex' }) as AccessClaims;
  } catch {
    throw unauthorized('Invalid or expired access token');
  }
}

/** Refresh tokens are JWTs whose `jti` is persisted, so they can be rotated and revoked. */
export async function issueRefreshToken(userId: string, family: string = randomUUID(), userAgent?: string) {
  const jti = randomUUID();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  await RefreshToken.create({ user: userId, jti, family, expiresAt, userAgent });
  const token = jwt.sign({ sub: userId, jti, fam: family }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.REFRESH_TOKEN_TTL_DAYS * 86_400,
    issuer: 'triagex',
  });
  return { token, expiresAt };
}

/**
 * Rotates a refresh token. Presenting an already-rotated token is treated as theft:
 * the whole token family is revoked and the user must sign in again.
 */
export async function rotateRefreshToken(token: string, userAgent?: string) {
  let claims: { sub: string; jti: string; fam: string };
  try {
    claims = jwt.verify(token, env.JWT_REFRESH_SECRET, { issuer: 'triagex' }) as typeof claims;
  } catch {
    throw unauthorized('Invalid refresh token');
  }
  const stored = await RefreshToken.findOne({ jti: claims.jti });
  if (!stored) throw unauthorized('Refresh token not recognised');
  if (stored.revokedAt) {
    await RefreshToken.updateMany({ family: stored.family, revokedAt: null }, { revokedAt: new Date() });
    await recordAudit('auth.refresh_reuse_detected', { id: claims.sub, name: 'unknown' }, { type: 'user', id: claims.sub }, { family: stored.family });
    throw unauthorized('Refresh token reuse detected; please sign in again');
  }
  const user = await User.findById(claims.sub);
  if (!user || !user.active) throw unauthorized('Account disabled');

  const next = await issueRefreshToken(String(user._id), stored.family, userAgent);
  stored.revokedAt = new Date();
  stored.replacedBy = (jwt.decode(next.token) as { jti: string }).jti;
  await stored.save();
  return { user, accessToken: signAccessToken(user), refresh: next };
}

export async function revokeRefreshToken(token: string | undefined) {
  if (!token) return;
  const decoded = jwt.decode(token) as { jti?: string } | null;
  if (decoded?.jti) await RefreshToken.updateOne({ jti: decoded.jti, revokedAt: null }, { revokedAt: new Date() });
}
