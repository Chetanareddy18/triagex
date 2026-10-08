import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from '../lib/domain.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { adminOnly, authenticate, currentUser, staffOnly } from '../middleware/auth.js';
import { objectId, validate } from '../middleware/validate.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { publicUser, User } from '../models/User.js';
import { currentAgentLoads } from '../services/assignment.js';
import { recordAudit } from '../services/audit.js';
import { hashPassword } from '../services/auth.js';
import { password } from './auth.js';

export const usersRouter = Router();
usersRouter.use(authenticate);

/** Agents (with live workload) for assignee pickers. */
usersRouter.get('/agents', staffOnly, async (_req, res) => {
  const loads = await currentAgentLoads();
  const admins = await User.find({ role: 'admin', active: true }, { name: 1 }).lean();
  res.json({
    agents: [
      ...loads.map((l) => ({ id: l.id, name: l.name, role: 'agent', load: l.load, open: l.open })),
      ...admins.map((a) => ({ id: String(a._id), name: a.name, role: 'admin', load: null, open: null })),
    ],
  });
});

const listQuery = z.object({
  role: z.enum(ROLES).optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

usersRouter.get('/', adminOnly, validate({ query: listQuery }), async (_req, res) => {
  const { role, q, page, limit } = res.locals.query as z.infer<typeof listQuery>;
  const filter: Record<string, unknown> = {};
  if (role) filter.role = role;
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { email: rx }];
  }
  const [items, total] = await Promise.all([
    User.find(filter).sort({ role: 1, name: 1 }).skip((page - 1) * limit).limit(limit),
    User.countDocuments(filter),
  ]);
  res.json({ items: items.map((u) => ({ ...publicUser(u), lastLoginAt: u.lastLoginAt, createdAt: u.createdAt })), total, page, limit });
});

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().transform((e) => e.toLowerCase()),
  password,
  role: z.enum(ROLES),
  title: z.string().trim().max(80).optional(),
});

usersRouter.post('/', adminOnly, validate({ body: createSchema }), async (req, res) => {
  const body = res.locals.body as z.infer<typeof createSchema>;
  if (await User.exists({ email: body.email })) throw conflict('An account with that email already exists');
  const user = await User.create({ ...body, passwordHash: await hashPassword(body.password) });
  const admin = currentUser(req);
  await recordAudit('user.created', admin, { type: 'user', id: String(user._id) }, { email: user.email, role: user.role });
  res.status(201).json({ user: publicUser(user) });
});

const patchSchema = z
  .object({
    role: z.enum(ROLES).optional(),
    active: z.boolean().optional(),
    name: z.string().trim().min(2).max(80).optional(),
    title: z.string().trim().max(80).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'nothing to update');

usersRouter.patch('/:id', adminOnly, validate({ params: z.object({ id: objectId }), body: patchSchema }), async (req, res) => {
  const { id } = res.locals.params as { id: string };
  const body = res.locals.body as z.infer<typeof patchSchema>;
  const admin = currentUser(req);
  if (id === admin.id && (body.role && body.role !== 'admin' || body.active === false)) {
    throw badRequest('You cannot demote or disable your own account');
  }
  const user = await User.findById(id);
  if (!user) throw notFound('User');
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(body)) {
    const key = k as keyof typeof body;
    if (v !== undefined && user.get(key) !== v) {
      changes[key] = { from: user.get(key), to: v };
      user.set(key, v);
    }
  }
  await user.save();
  if (body.active === false || body.role) await RefreshToken.updateMany({ user: user._id, revokedAt: null }, { revokedAt: new Date() });
  if (Object.keys(changes).length) await recordAudit('user.updated', admin, { type: 'user', id }, { changes });
  res.json({ user: publicUser(user) });
});
