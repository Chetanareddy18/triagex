import { Router } from 'express';
import { z } from 'zod';
import { adminOnly, authenticate, currentUser, staffOnly } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AuditCheckpoint, AuditLog } from '../models/AuditLog.js';
import { SlaPolicy } from '../models/misc.js';
import { createCheckpoint, recordAudit, verifyChain } from '../services/audit.js';
import { autoAssignOne } from '../services/incidents.js';
import { loadPolicies, runSlaScan } from '../services/sla.js';

// ----------------------------------------------------------------------------- SLA
export const slaRouter = Router();
slaRouter.use(authenticate);

slaRouter.get('/policies', async (_req, res) => {
  const map = await loadPolicies();
  res.json({ policies: [1, 2, 3, 4].map((priority) => ({ priority, ...map[priority] })) });
});

const policiesSchema = z.object({
  policies: z
    .array(
      z
        .object({
          priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
          responseMinutes: z.number().int().min(1).max(60 * 24 * 30),
          resolutionMinutes: z.number().int().min(1).max(60 * 24 * 90),
        })
        .refine((p) => p.responseMinutes <= p.resolutionMinutes, 'response target must not exceed resolution target'),
    )
    .min(1)
    .max(4),
});

slaRouter.put('/policies', adminOnly, validate({ body: policiesSchema }), async (req, res) => {
  const { policies } = res.locals.body as z.infer<typeof policiesSchema>;
  const admin = currentUser(req);
  const before = await loadPolicies();
  for (const p of policies) {
    await SlaPolicy.updateOne({ priority: p.priority }, { $set: { ...p, updatedBy: admin.id } }, { upsert: true });
  }
  await recordAudit('sla.policies_updated', admin, { type: 'sla_policy', id: 'global' }, {
    changes: policies.map((p) => ({ priority: p.priority, from: before[p.priority], to: { responseMinutes: p.responseMinutes, resolutionMinutes: p.resolutionMinutes } })),
  });
  const map = await loadPolicies();
  res.json({ policies: [1, 2, 3, 4].map((priority) => ({ priority, ...map[priority] })), note: 'Applies to new incidents and to priority changes' });
});

slaRouter.post('/scan', staffOnly, async (_req, res) => {
  res.json(await runSlaScan(new Date(), (id) => autoAssignOne(id)));
});

// ----------------------------------------------------------------------------- audit
export const auditRouter = Router();
auditRouter.use(authenticate, adminOnly);

const auditQuery = z.object({
  entityId: z.string().max(40).optional(),
  action: z.string().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

auditRouter.get('/', validate({ query: auditQuery }), async (_req, res) => {
  const { entityId, action, page, limit } = res.locals.query as z.infer<typeof auditQuery>;
  const filter: Record<string, unknown> = {};
  if (entityId) filter.entityId = entityId;
  if (action) filter.action = { $regex: `^${action.replace(/[^a-z_.]/gi, '')}` };
  const [items, total, head] = await Promise.all([
    AuditLog.find(filter, { _id: 0 }).sort({ seq: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AuditLog.countDocuments(filter),
    AuditLog.findOne({}, { _id: 0, seq: 1, hash: 1 }).sort({ seq: -1 }).lean(),
  ]);
  res.json({ items, total, page, limit, head });
});

auditRouter.get('/verify', async (_req, res) => {
  res.json(await verifyChain());
});

auditRouter.get('/checkpoints', async (_req, res) => {
  res.json({ items: await AuditCheckpoint.find({}, { _id: 0 }).sort({ seq: -1 }).limit(50).lean() });
});

auditRouter.post('/checkpoints', async (req, res) => {
  const admin = currentUser(req);
  const verify = await verifyChain();
  if (!verify.ok) return res.status(409).json({ error: { code: 'CHAIN_INVALID', message: 'Refusing to sign a chain that fails verification', details: verify.firstInvalid } });
  const cp = await createCheckpoint(admin.id);
  res.status(201).json({ checkpoint: cp });
});
