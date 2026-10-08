import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { OPEN_STATUSES, PRIORITY_WEIGHT } from '../lib/domain.js';
import { authenticate, currentUser } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Incident } from '../models/Incident.js';
import { User } from '../models/User.js';

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

const query = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

const DAY = 86_400_000;

dashboardRouter.get('/summary', validate({ query }), async (req, res) => {
  const user = currentUser(req);
  const { days } = res.locals.query as z.infer<typeof query>;
  const now = new Date();
  const since = new Date(now.getTime() - days * DAY);
  const scope: Record<string, unknown> = user.role === 'reporter' ? { reporter: new Types.ObjectId(user.id) } : {};

  const [resolvedStats, openByPriority, openByStatus, openSla, created, resolved, workload, aiAgreement, totals] = await Promise.all([
    // MTTR + SLA compliance over incidents resolved in the window
    Incident.aggregate<{ count: number; mttrMs: number; met: number; medianMs: number[] }>([
      { $match: { ...scope, 'resolution.resolvedAt': { $gte: since } } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          mttrMs: { $avg: { $subtract: ['$resolution.resolvedAt', '$createdAt'] } },
          met: { $sum: { $cond: [{ $eq: ['$sla.state', 'met'] }, 1, 0] } },
          medianMs: {
            $percentile: { input: { $subtract: ['$resolution.resolvedAt', '$createdAt'] }, p: [0.5], method: 'approximate' },
          },
        },
      },
    ]),
    Incident.aggregate<{ _id: number; count: number }>([
      { $match: { ...scope, status: { $in: OPEN_STATUSES } } },
      { $group: { _id: '$priority', count: { $sum: 1 } } },
    ]),
    Incident.aggregate<{ _id: string; count: number }>([{ $match: scope }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Incident.aggregate<{ _id: string; count: number }>([
      { $match: { ...scope, status: { $in: OPEN_STATUSES } } },
      { $group: { _id: '$sla.state', count: { $sum: 1 } } },
    ]),
    Incident.aggregate<{ _id: string; count: number }>([
      { $match: { ...scope, createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
    ]),
    Incident.aggregate<{ _id: string; count: number; breached: number }>([
      { $match: { ...scope, 'resolution.resolvedAt': { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$resolution.resolvedAt' } },
          count: { $sum: 1 },
          breached: { $sum: { $cond: [{ $eq: ['$sla.state', 'breached'] }, 1, 0] } },
        },
      },
    ]),
    user.role === 'reporter'
      ? Promise.resolve([])
      : Incident.aggregate<{ _id: Types.ObjectId; open: number; load: number; resolved: number; p1: number }>([
          { $match: { assignee: { $ne: null }, $or: [{ status: { $in: OPEN_STATUSES } }, { 'resolution.resolvedAt': { $gte: since } }] } },
          {
            $group: {
              _id: '$assignee',
              open: { $sum: { $cond: [{ $in: ['$status', OPEN_STATUSES] }, 1, 0] } },
              p1: { $sum: { $cond: [{ $and: [{ $in: ['$status', OPEN_STATUSES] }, { $eq: ['$priority', 1] }] }, 1, 0] } },
              load: {
                $sum: {
                  $cond: [
                    { $in: ['$status', OPEN_STATUSES] },
                    { $switch: { branches: ([1, 2, 3] as const).map((p) => ({ case: { $eq: ['$priority', p] }, then: PRIORITY_WEIGHT[p] })), default: 1 } },
                    0,
                  ],
                },
              },
              resolved: { $sum: { $cond: [{ $gte: ['$resolution.resolvedAt', since] }, 1, 0] } },
            },
          },
        ]),
    // How often the final priority matches the AI suggestion (agent-reviewed tickets only)
    Incident.aggregate<{ total: number; agree: number; bySource: { source: string }[] }>([
      { $match: { ...scope, ai: { $ne: null }, status: { $in: ['resolved', 'closed'] }, createdAt: { $gte: since } } },
      { $group: { _id: null, total: { $sum: 1 }, agree: { $sum: { $cond: [{ $eq: ['$ai.priority', '$priority'] }, 1, 0] } } } },
    ]),
    Incident.countDocuments({ ...scope, createdAt: { $gte: since } }),
  ]);

  const agents = await User.find({ role: { $in: ['agent', 'admin'] }, active: true }, { name: 1, role: 1 }).lean();
  const workloadById = new Map(workload.map((w) => [String(w._id), w]));
  const series: { date: string; created: number; resolved: number; breached: number }[] = [];
  const createdMap = new Map(created.map((c) => [c._id, c.count]));
  const resolvedMap = new Map(resolved.map((r) => [r._id, r]));
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now.getTime() - i * DAY).toISOString().slice(0, 10);
    series.push({
      date,
      created: createdMap.get(date) ?? 0,
      resolved: resolvedMap.get(date)?.count ?? 0,
      breached: resolvedMap.get(date)?.breached ?? 0,
    });
  }

  const r = resolvedStats[0];
  const statusCounts = Object.fromEntries(openByStatus.map((s) => [s._id, s.count]));
  const slaCounts = Object.fromEntries(openSla.map((s) => [s._id, s.count]));
  res.json({
    windowDays: days,
    totals: {
      createdInWindow: totals,
      resolvedInWindow: r?.count ?? 0,
      open: OPEN_STATUSES.reduce((sum, s) => sum + (statusCounts[s] ?? 0), 0),
      openAtRisk: slaCounts.at_risk ?? 0,
      openBreached: slaCounts.breached ?? 0,
    },
    mttrHours: r ? Math.round((r.mttrMs / 3_600_000) * 10) / 10 : null,
    medianTtrHours: r?.medianMs?.[0] != null ? Math.round((r.medianMs[0] / 3_600_000) * 10) / 10 : null,
    slaCompliance: r && r.count ? Math.round((r.met / r.count) * 1000) / 10 : null,
    openByPriority: [1, 2, 3, 4].map((p) => ({ priority: p, count: openByPriority.find((o) => o._id === p)?.count ?? 0 })),
    byStatus: ['new', 'assigned', 'in_progress', 'resolved', 'closed'].map((s) => ({ status: s, count: statusCounts[s] ?? 0 })),
    trend: series,
    workload: agents
      .map((a) => {
        const w = workloadById.get(String(a._id));
        return { id: String(a._id), name: a.name, role: a.role, open: w?.open ?? 0, p1: w?.p1 ?? 0, load: w?.load ?? 0, resolved: w?.resolved ?? 0 };
      })
      .filter((a) => a.role === 'agent' || a.open > 0 || a.resolved > 0)
      .sort((a, b) => b.load - a.load),
    aiAgreement: aiAgreement[0]?.total ? Math.round((aiAgreement[0].agree / aiAgreement[0].total) * 1000) / 10 : null,
  });
});
