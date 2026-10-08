import { Router, type CookieOptions, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config/env.js';
import { conflict, unauthorized } from '../lib/errors.js';
import { authenticate, currentUser } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { publicUser, User } from '../models/User.js';
import { recordAudit } from '../services/audit.js';
import { hashPassword, issueRefreshToken, revokeRefreshToken, rotateRefreshToken, signAccessToken, verifyPassword } from '../services/auth.js';

export const REFRESH_COOKIE = 'tx_refresh';

const cookieOptions = (expires?: Date): CookieOptions => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SAMESITE,
  path: '/api/auth',
  expires,
});

function setRefreshCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(REFRESH_COOKIE, token, cookieOptions(expiresAt));
}

export const password = z
  .string()
  .min(8, 'at least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'must contain a letter')
  .regex(/\d/, 'must contain a digit');

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().max(160).transform((e) => e.toLowerCase()),
  password,
});
const loginSchema = z.object({ email: z.email().transform((e) => e.toLowerCase()), password: z.string().min(1).max(128) });

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again later' } },
});

authRouter.post('/register', authLimiter, validate({ body: registerSchema }), async (req, res) => {
  const { name, email, password: plain } = res.locals.body as z.infer<typeof registerSchema>;
  if (await User.exists({ email })) throw conflict('An account with that email already exists');
  const user = await User.create({ name, email, passwordHash: await hashPassword(plain), role: 'reporter' });
  await recordAudit('user.registered', { id: String(user._id), name }, { type: 'user', id: String(user._id) }, { email, role: user.role });
  const refresh = await issueRefreshToken(String(user._id), undefined, req.get('user-agent'));
  setRefreshCookie(res, refresh.token, refresh.expiresAt);
  res.status(201).json({ user: publicUser(user), accessToken: signAccessToken(user) });
});

authRouter.post('/login', authLimiter, validate({ body: loginSchema }), async (req, res) => {
  const { email, password: plain } = res.locals.body as z.infer<typeof loginSchema>;
  const user = await User.findOne({ email }).select('+passwordHash');
  // Same error for unknown email and wrong password (no account enumeration).
  if (!user || !(await verifyPassword(plain, user.passwordHash))) throw unauthorized('Invalid email or password');
  if (!user.active) throw unauthorized('This account has been disabled');
  user.lastLoginAt = new Date();
  await user.save();
  const refresh = await issueRefreshToken(String(user._id), undefined, req.get('user-agent'));
  setRefreshCookie(res, refresh.token, refresh.expiresAt);
  await recordAudit('auth.login', { id: String(user._id), name: user.name }, { type: 'user', id: String(user._id) }, {});
  res.json({ user: publicUser(user), accessToken: signAccessToken(user) });
});

authRouter.post('/refresh', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!token) throw unauthorized('No refresh token');
  try {
    const { user, accessToken, refresh } = await rotateRefreshToken(token, req.get('user-agent'));
    setRefreshCookie(res, refresh.token, refresh.expiresAt);
    res.json({ user: publicUser(user), accessToken });
  } catch (err) {
    res.clearCookie(REFRESH_COOKIE, cookieOptions());
    throw err;
  }
});

authRouter.post('/logout', async (req, res) => {
  await revokeRefreshToken(req.cookies?.[REFRESH_COOKIE]);
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
  res.status(204).end();
});

authRouter.get('/me', authenticate, async (req, res) => {
  const user = await User.findById(currentUser(req).id);
  if (!user || !user.active) throw unauthorized();
  res.json({ user: publicUser(user) });
});
