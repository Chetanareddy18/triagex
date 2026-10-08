import { env } from '../config/env.js';
import { DEFAULT_SLA_POLICIES, OPEN_STATUSES, type Priority, type SlaState } from '../lib/domain.js';
import { logger } from '../lib/logger.js';
import { Incident, type IIncident, type SlaInfo } from '../models/Incident.js';
import { JobLock, SlaPolicy } from '../models/misc.js';
import { recordAudit, SYSTEM_ACTOR } from './audit.js';
import { adminIds, notify, staffIds } from './notifications.js';
import { emitIncident } from './realtime.js';

const MINUTE = 60_000;

export interface PolicyMap {
  [priority: number]: { responseMinutes: number; resolutionMinutes: number };
}

export async function ensureDefaultPolicies(): Promise<void> {
  await Promise.all(
    DEFAULT_SLA_POLICIES.map((p) =>
      SlaPolicy.updateOne({ priority: p.priority }, { $setOnInsert: p }, { upsert: true }),
    ),
  );
}

export async function loadPolicies(): Promise<PolicyMap> {
  const docs = await SlaPolicy.find().lean();
  const map: PolicyMap = {};
  for (const p of DEFAULT_SLA_POLICIES) map[p.priority] = p;
  for (const d of docs) map[d.priority] = { responseMinutes: d.responseMinutes, resolutionMinutes: d.resolutionMinutes };
  return map;
}

export function computeDueDates(openedAt: Date, priority: Priority, policies: PolicyMap) {
  const policy = policies[priority];
  return {
    responseDueAt: new Date(openedAt.getTime() + policy.responseMinutes * MINUTE),
    resolutionDueAt: new Date(openedAt.getTime() + policy.resolutionMinutes * MINUTE),
  };
}

/** Pure SLA evaluation for an incident at time `now`. */
export function evaluateSla(
  incident: Pick<IIncident, 'status' | 'createdAt'> & { sla: Pick<SlaInfo, 'resolutionDueAt' | 'state'> },
  now: Date,
  atRiskRatio = env.SLA_AT_RISK_RATIO,
): SlaState {
  const { status, sla, createdAt } = incident;
  if (!OPEN_STATUSES.includes(status)) return sla.state === 'breached' ? 'breached' : 'met';
  if (sla.state === 'breached') return 'breached'; // a breach is never un-done
  const due = sla.resolutionDueAt.getTime();
  if (now.getTime() > due) return 'breached';
  const total = due - createdAt.getTime();
  const elapsed = now.getTime() - createdAt.getTime();
  return total > 0 && elapsed / total >= atRiskRatio ? 'at_risk' : 'on_track';
}

/** Percentage of the resolution window consumed (can exceed 100 when breached). */
export function slaProgress(incident: Pick<IIncident, 'createdAt'> & { sla: Pick<SlaInfo, 'resolutionDueAt'> }, now = new Date()) {
  const total = incident.sla.resolutionDueAt.getTime() - incident.createdAt.getTime();
  return total > 0 ? Math.round(((now.getTime() - incident.createdAt.getTime()) / total) * 100) : 100;
}

// --------------------------------------------------------------------------- scanner
async function acquireLock(name: string, ttlMs: number, owner: string): Promise<boolean> {
  const now = new Date();
  try {
    const res = await JobLock.findOneAndUpdate(
      { _id: name, $or: [{ lockedUntil: { $lt: now } }, { owner }] },
      { owner, lockedUntil: new Date(now.getTime() + ttlMs) },
      { upsert: true, returnDocument: 'after' },
    );
    return res?.owner === owner;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false; // held by another instance
    throw err;
  }
}

const OWNER = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

export interface ScanResult {
  scanned: number;
  atRisk: number;
  breached: number;
  escalated: number;
  responseBreached: number;
}

type AutoAssign = (incidentId: string) => Promise<unknown>;

/**
 * Finds open incidents whose SLA state changed and applies the consequences:
 *  - at risk  -> notify assignee (or all staff when unassigned)
 *  - breached -> escalate: priority +1 level, notify admins + assignee, auto-assign if unassigned
 * Each state change is applied with a compare-and-set on the previous state, so
 * concurrent scanners never double-notify.
 */
export async function runSlaScan(now = new Date(), autoAssign?: AutoAssign): Promise<ScanResult> {
  const result: ScanResult = { scanned: 0, atRisk: 0, breached: 0, escalated: 0, responseBreached: 0 };
  if (!(await acquireLock('sla-scan', 55_000, OWNER))) return result;

  const policies = await loadPolicies();
  // Response SLA: no first response before responseDueAt.
  const responseBreaches = await Incident.find({
    status: 'new',
    'sla.firstRespondedAt': null,
    'sla.responseBreached': false,
    'sla.responseDueAt': { $lt: now },
  }).select('_id number');
  for (const inc of responseBreaches) {
    const updated = await Incident.updateOne(
      { _id: inc._id, 'sla.responseBreached': false },
      {
        $set: { 'sla.responseBreached': true },
        $push: { timeline: { type: 'sla_response_breached', at: now, message: 'First-response target missed', actorName: SYSTEM_ACTOR.name } },
      },
    );
    if (updated.modifiedCount) result.responseBreached++;
  }

  const candidates = await Incident.find({ status: { $in: OPEN_STATUSES }, 'sla.state': { $in: ['on_track', 'at_risk'] } }).select(
    '_id number title priority status createdAt sla assignee reporter',
  );
  result.scanned = candidates.length;

  for (const inc of candidates) {
    const next = evaluateSla(inc, now);
    if (next === inc.sla.state) continue;

    if (next === 'at_risk') {
      const updated = await Incident.findOneAndUpdate(
        { _id: inc._id, 'sla.state': 'on_track' },
        {
          $set: { 'sla.state': 'at_risk', 'sla.atRiskAt': now },
          $push: { timeline: { type: 'sla_at_risk', at: now, message: 'SLA at risk', actorName: SYSTEM_ACTOR.name } },
        },
        { returnDocument: 'after' },
      );
      if (!updated) continue;
      result.atRisk++;
      const recipients = updated.assignee ? [String(updated.assignee)] : await staffIds();
      await notify(recipients, {
        type: 'sla_at_risk',
        title: `${updated.number} is at risk of breaching SLA`,
        body: `Resolution due ${updated.sla.resolutionDueAt.toISOString()}`,
        incident: updated,
      });
      await recordAudit('sla.at_risk', SYSTEM_ACTOR, { type: 'incident', id: String(updated._id) }, { number: updated.number });
      emitIncident('incident:updated', updated, { id: String(updated._id), number: updated.number, reason: 'sla' });
    }

    if (next === 'breached') {
      const raised = Math.max(1, inc.priority - 1) as Priority;
      const escalate = raised !== inc.priority;
      const due = escalate ? computeDueDates(inc.createdAt, raised, policies) : null;
      const updated = await Incident.findOneAndUpdate(
        { _id: inc._id, 'sla.state': inc.sla.state },
        {
          $set: {
            'sla.state': 'breached',
            'sla.breachedAt': now,
            priority: raised,
            ...(due ? { 'sla.responseDueAt': due.responseDueAt } : {}),
          },
          $inc: { 'sla.escalationLevel': 1 },
          $push: {
            timeline: {
              type: 'sla_breached',
              at: now,
              actorName: SYSTEM_ACTOR.name,
              message: escalate ? `SLA breached - escalated from P${inc.priority} to P${raised}` : 'SLA breached - escalated to admins',
              data: { from: inc.priority, to: raised },
            },
          },
        },
        { returnDocument: 'after' },
      );
      if (!updated) continue;
      result.breached++;
      if (escalate) result.escalated++;
      await notify([...(await adminIds()), updated.assignee ? String(updated.assignee) : null], {
        type: 'sla_breached',
        title: `SLA breached: ${updated.number}`,
        body: `${updated.title} (now P${updated.priority})`,
        incident: updated,
      });
      await recordAudit('sla.breached', SYSTEM_ACTOR, { type: 'incident', id: String(updated._id) }, {
        number: updated.number,
        priorityFrom: inc.priority,
        priorityTo: raised,
      });
      emitIncident('incident:updated', updated, { id: String(updated._id), number: updated.number, reason: 'sla' });
      if (!updated.assignee && autoAssign && env.AUTO_ASSIGN_ON_BREACH) {
        await autoAssign(String(updated._id)).catch((err) => logger.warn({ err }, 'auto-assign on breach failed'));
      }
    }
  }
  if (result.atRisk || result.breached) logger.info(result, 'sla scan');
  return result;
}
