import { createHash, timingSafeEqual } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { env } from '../config/env.js';
import { CATEGORIES, OPEN_STATUSES } from '../lib/domain.js';
import { notFound, unauthorized } from '../lib/errors.js';
import { authenticate, currentUser } from '../middleware/auth.js';
import { objectId, validate } from '../middleware/validate.js';
import { Incident } from '../models/Incident.js';
import { Notification } from '../models/misc.js';
import { User } from '../models/User.js';
import { recordAudit } from '../services/audit.js';
import { hashPassword, verifyAccessToken } from '../services/auth.js';
import { createIncident, summary } from '../services/incidents.js';
import { mlHealth, mlMetrics } from '../services/ml.js';
import { emitIncident } from '../services/realtime.js';

// ----------------------------------------------------------------------------- notifications
export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

notificationsRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  const [items, unread] = await Promise.all([
    Notification.find({ user: user.id }).sort({ createdAt: -1 }).limit(30),
    Notification.countDocuments({ user: user.id, readAt: null }),
  ]);
  res.json({ items, unread });
});

notificationsRouter.post('/read-all', async (req, res) => {
  await Notification.updateMany({ user: currentUser(req).id, readAt: null }, { readAt: new Date() });
  res.status(204).end();
});

notificationsRouter.post('/:id/read', validate({ params: z.object({ id: objectId }) }), async (req, res) => {
  const doc = await Notification.findOneAndUpdate({ _id: req.params.id, user: currentUser(req).id }, { readAt: new Date() }, { returnDocument: 'after' });
  if (!doc) throw notFound('Notification');
  res.json({ notification: doc });
});

// ----------------------------------------------------------------------------- ml proxy
export const mlRouter = Router();
mlRouter.use(authenticate);

mlRouter.get('/health', async (_req, res) => {
  const health = await mlHealth();
  res.json({ available: Boolean(health), ...(health ?? {}) });
});

mlRouter.get('/metrics', async (_req, res) => {
  const metrics = await mlMetrics();
  if (!metrics) return res.status(503).json({ error: { code: 'ML_UNAVAILABLE', message: 'ML service is not reachable' } });
  res.json(metrics);
});

// ----------------------------------------------------------------------------- alert ingestion (de-dup)
export const alertsRouter = Router();

/** Accepts either `x-alert-key: <ALERT_INGEST_KEY>` or a staff bearer token. */
function alertAuth(req: Request, _res: Response, next: NextFunction) {
  const key = req.get('x-alert-key');
  if (key && env.ALERT_INGEST_KEY) {
    const a = createHash('sha256').update(key).digest();
    const b = createHash('sha256').update(env.ALERT_INGEST_KEY).digest();
    if (timingSafeEqual(a, b)) return next();
    return next(unauthorized('Invalid alert key'));
  }
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) return next(unauthorized('Alert key or staff token required'));
  const claims = verifyAccessToken(header.slice(7));
  if (claims.role === 'reporter') return next(unauthorized('Staff token required'));
  req.user = { id: claims.sub, role: claims.role, name: claims.name, email: claims.email };
  next();
}

const alertSchema = z.object({
  source: z.string().trim().min(1).max(60),
  title: z.string().trim().min(5).max(200),
  description: z.string().trim().max(5000).default(''),
  severity: z.enum(['critical', 'high', 'warning', 'info']).default('warning'),
  fingerprint: z.string().trim().min(1).max(200).optional(),
  category: z.enum(CATEGORIES).optional(),
  service: z.string().trim().max(80).optional(),
});

const SEVERITY_TO_LEVELS: Record<string, { impact: 1 | 2 | 3; urgency: 1 | 2 | 3 }> = {
  critical: { impact: 1, urgency: 1 },
  high: { impact: 1, urgency: 2 },
  warning: { impact: 2, urgency: 2 },
  info: { impact: 3, urgency: 3 },
};

async function monitoringBot() {
  const email = 'monitoring-bot@triagex.local';
  const existing = await User.findOne({ email });
  if (existing) return existing;
  // Random unusable password: the bot never signs in.
  const passwordHash = await hashPassword(crypto.randomUUID() + crypto.randomUUID());
  return User.create({ name: 'Monitoring', email, passwordHash, role: 'reporter', title: 'Alert ingestion', active: false });
}

/**
 * Alert de-duplication: alerts with the same fingerprint (explicit, or derived from
 * source + service + normalised title) fold into the open incident instead of
 * creating a new one.
 */
alertsRouter.post('/ingest', alertAuth, validate({ body: alertSchema }), async (req, res) => {
  const alert = res.locals.body as z.infer<typeof alertSchema>;
  const normalisedTitle = alert.title.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ');
  const fingerprint =
    alert.fingerprint ?? createHash('sha256').update(`${alert.source}|${alert.service ?? ''}|${normalisedTitle}`).digest('hex').slice(0, 32);

  const now = new Date();
  const existing = await Incident.findOneAndUpdate(
    { fingerprint, status: { $in: OPEN_STATUSES } },
    {
      $inc: { occurrences: 1 },
      $set: { lastOccurrenceAt: now },
      $push: { timeline: { type: 'alert_duplicate', at: now, actorName: alert.source, message: `Duplicate alert from ${alert.source} folded in` } },
    },
    { returnDocument: 'after' },
  );
  if (existing) {
    await recordAudit('alert.deduplicated', { id: 'system', name: alert.source }, { type: 'incident', id: String(existing._id) }, {
      fingerprint,
      occurrences: existing.occurrences,
    });
    emitIncident('incident:updated', existing, summary(existing));
    return res.status(200).json({ deduplicated: true, incident: { id: String(existing._id), number: existing.number, occurrences: existing.occurrences } });
  }

  const bot = await monitoringBot();
  const levels = SEVERITY_TO_LEVELS[alert.severity];
  const { incident } = await createIncident(
    {
      title: alert.title,
      description: alert.description,
      channel: 'monitoring',
      category: alert.category,
      ...levels,
      tags: ['alert', alert.source.toLowerCase().slice(0, 30)],
      fingerprint,
    },
    { id: String(bot._id), name: `${bot.name} (${alert.source})`, role: 'reporter' },
  );
  res.status(201).json({ deduplicated: false, incident: { id: String(incident._id), number: incident.number, occurrences: 1 } });
});

// ----------------------------------------------------------------------------- health
export const healthRouter = Router();
healthRouter.get('/', async (_req, res) => {
  const mongo = mongoose.connection.readyState === 1;
  const ml = await mlHealth();
  res.status(mongo ? 200 : 503).json({ status: mongo ? 'ok' : 'degraded', mongo, ml: ml ? { available: true, embedding: ml.embedding.model } : { available: false } });
});

