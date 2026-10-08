/**
 * Seeds a realistic demo workspace: demo accounts, ~140 incidents over the last
 * 45 days across every lifecycle state, comments, notifications and a valid audit chain.
 *
 *   npm run seed            (drops the TriageX collections first)
 *   SEED_INCIDENTS=300 npm run seed
 *
 * If the ML service is running, each incident is triaged by it (in chronological
 * order, so neighbours come from earlier tickets) and embeddings are stored.
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { itilPriority, PRIORITY_LABEL, type Priority, type Status } from '../lib/domain.js';
import { AuditCheckpoint, AuditLog } from '../models/AuditLog.js';
import { Incident, type TimelineEvent } from '../models/Incident.js';
import { Comment, Counter, Notification, SlaPolicy } from '../models/misc.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { User } from '../models/User.js';
import { createCheckpoint, flushAudit, recordAudit, SYSTEM_ACTOR } from '../services/audit.js';
import { hashPassword } from '../services/auth.js';
import { mlHealth, triageIncident } from '../services/ml.js';
import { computeDueDates, ensureDefaultPolicies, loadPolicies } from '../services/sla.js';
import { COMMENTS, DETAILS, HOSTS, OFFICES, SERVICES, TEMPLATES } from './seedData.js';

export const DEMO_PASSWORD = 'Demo@1234';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Deterministic PRNG so every seed produces the same workspace.
let state = 20260309;
const rand = () => {
  state = (state * 1664525 + 1013904223) % 4294967296;
  return state / 4294967296;
};
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const between = (a: number, b: number) => a + rand() * (b - a);

const USERS = [
  { name: 'Aarav Mehta', email: 'admin@triagex.dev', role: 'admin', title: 'Head of IT Operations' },
  { name: 'Diya Sharma', email: 'agent@triagex.dev', role: 'agent', title: 'SRE' },
  { name: 'Kabir Rao', email: 'kabir@triagex.dev', role: 'agent', title: 'Service Desk Lead' },
  { name: 'Meera Iyer', email: 'meera@triagex.dev', role: 'agent', title: 'Network Engineer' },
  { name: 'Rohan Gupta', email: 'rohan@triagex.dev', role: 'agent', title: 'Platform Engineer' },
  { name: 'Ananya Nair', email: 'reporter@triagex.dev', role: 'reporter', title: 'Product Manager' },
  { name: 'Vikram Singh', email: 'vikram@triagex.dev', role: 'reporter', title: 'Finance Analyst' },
  { name: 'Ishita Das', email: 'ishita@triagex.dev', role: 'reporter', title: 'Marketing Lead' },
  { name: 'Arjun Reddy', email: 'arjun@triagex.dev', role: 'reporter', title: 'Customer Success' },
] as const;

const fill = (s: string, ctx: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k: string) => ctx[k] ?? k);

/** Typical time-to-resolve by priority (hours) - breaches are drawn separately. */
const TTR: Record<Priority, [number, number]> = { 1: [0.7, 3.5], 2: [1.5, 7], 3: [3, 20], 4: [8, 60] };

async function main() {
  await mongoose.connect(env.MONGO_URI);
  console.log(`seeding ${mongoose.connection.name} ...`);
  for (const model of [User, Incident, Comment, Notification, AuditLog, AuditCheckpoint, RefreshToken, Counter, SlaPolicy]) {
    await model.collection.drop().catch(() => undefined);
  }
  await mongoose.connection.syncIndexes();
  await ensureDefaultPolicies();
  const policies = await loadPolicies();

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const users = await User.insertMany(USERS.map((u) => ({ ...u, passwordHash, lastLoginAt: new Date() })));
  for (const u of users) await recordAudit('user.created', SYSTEM_ACTOR, { type: 'user', id: String(u._id) }, { email: u.email, role: u.role, seed: true });
  const agents = users.filter((u) => u.role === 'agent');
  const admin = users.find((u) => u.role === 'admin')!;
  const reporters = users.filter((u) => u.role === 'reporter');

  const ml = await mlHealth();
  console.log(ml ? `ML service online (${ml.embedding.model})` : 'ML service offline - using rule-based triage; embeddings will be backfilled');

  const total = Number(process.env.SEED_INCIDENTS ?? 200);
  const now = Date.now();
  // Chronological creation times, denser in recent weeks.
  const recent = Math.round(total * 0.09); // the live queue: opened in the last 3 days
  const times = [
    ...Array.from({ length: total - recent }, () => now - (3 * DAY + rand() * 42 * DAY)),
    ...Array.from({ length: recent }, () => now - rand() * 3 * DAY),
  ].sort((a, b) => a - b);
  let seq = 0;

  for (const createdMs of times) {
    const tpl = pick(TEMPLATES);
    const ctx = {
      service: pick(SERVICES),
      office: pick(OFFICES),
      host: pick(HOSTS),
      n: String(Math.floor(between(2, 40))),
      time: `${String(Math.floor(between(7, 22))).padStart(2, '0')}:${pick(['05', '20', '35', '50'])}`,
    };
    const title = fill(tpl.title, ctx);
    const description = `${fill(tpl.description, ctx)} ${fill(pick(DETAILS), ctx)}`.trim();
    const createdAt = new Date(createdMs);
    const reporter = tpl.channel === 'monitoring' ? admin : pick(reporters);
    // Real-world noise: reporters do not always rate impact/urgency the way an agent would.
    const impact = (rand() < 0.2 ? Math.min(3, Math.max(1, tpl.impact + (rand() < 0.5 ? -1 : 1))) : tpl.impact) as 1 | 2 | 3;
    const urgency = tpl.urgency;
    const declared = itilPriority(impact, urgency);
    const settled = itilPriority(tpl.impact, tpl.urgency); // what an agent settles on

    const { ai, embedding } = await triageIncident({ title, description, channel: tpl.channel, impact, urgency, openedAt: createdAt });
    const due = computeDueDates(createdAt, settled, policies);
    const ageH = (now - createdMs) / HOUR;

    // Lifecycle: older tickets are mostly done, recent ones still open.
    const windowH = policies[settled].resolutionMinutes / 60;
    const breach = rand() < (settled <= 2 ? 0.18 : 0.1);
    const ttrH = breach ? windowH * between(1.05, 1.8) : Math.min(between(...TTR[settled]), windowH * 0.95);
    let status: Status;
    if (ageH > ttrH + 2) status = rand() < 0.65 ? 'closed' : 'resolved';
    else if (ageH > 0.4) status = rand() < 0.55 ? 'in_progress' : 'assigned';
    else status = 'new';
    if (ageH < 96 && status !== 'new' && rand() < 0.08) status = 'new'; // a few stragglers in the queue
    if (ageH < 40 && rand() < 0.8) {
      // keep the live queue busy: most of today's tickets are still being worked
      const r = rand();
      status = r < 0.3 ? 'new' : r < 0.55 ? 'assigned' : 'in_progress';
    }

    const assignee = status === 'new' ? null : pick(agents);
    const timeline: TimelineEvent[] = [
      { type: 'created', at: createdAt, actor: reporter._id, actorName: reporter.name, message: `Incident reported via ${tpl.channel}` },
      {
        type: 'ai_triage',
        at: createdAt,
        actor: null,
        actorName: SYSTEM_ACTOR.name,
        message: `AI triage suggests P${ai.priority} / ${ai.category} (confidence ${Math.round(ai.priorityConfidence * 100)}%)`,
        data: { source: ai.source, priority: ai.priority, confidence: ai.priorityConfidence, applied: false },
      },
    ];
    const at = (h: number) => new Date(createdMs + h * HOUR);
    const firstResponseH = Math.min(ttrH * 0.2, between(0.05, policies[settled].responseMinutes / 60));
    if (assignee) {
      timeline.push({ type: 'assignment', at: at(firstResponseH), actor: admin._id, actorName: admin.name, message: `Assigned to ${assignee.name}`, data: { to: String(assignee._id), reason: 'manual' } });
      timeline.push({ type: 'status', at: at(firstResponseH), actor: assignee._id, actorName: assignee.name, message: 'Assigned', data: { from: 'new', to: 'assigned', transition: 'assign' } });
    }
    if (declared !== settled && assignee) {
      timeline.push({ type: 'updated', at: at(firstResponseH * 1.1), actor: assignee._id, actorName: assignee.name, message: `Updated priority ${declared} -> ${settled}`, data: { fields: ['priority'] } });
    }
    if (status === 'in_progress' || status === 'resolved' || status === 'closed') {
      timeline.push({ type: 'status', at: at(firstResponseH * 1.5), actor: assignee!._id, actorName: assignee!.name, message: 'Work started', data: { from: 'assigned', to: 'in_progress', transition: 'start' } });
    }
    const done = status === 'resolved' || status === 'closed';
    if (done) {
      timeline.push({ type: 'status', at: at(ttrH), actor: assignee!._id, actorName: assignee!.name, message: 'Resolved', data: { from: 'in_progress', to: 'resolved', transition: 'resolve' } });
    }
    if (status === 'closed') {
      timeline.push({ type: 'status', at: at(ttrH + 1.5), actor: reporter._id, actorName: reporter.name, message: 'Closed', data: { from: 'resolved', to: 'closed', transition: 'close' } });
    }

    // SLA state for open tickets depends on how much of the window has elapsed.
    let slaState: 'on_track' | 'at_risk' | 'breached' | 'met' = 'on_track';
    if (done) slaState = breach ? 'breached' : 'met';
    else if (ageH > windowH) slaState = 'breached';
    else if (ageH / windowH >= env.SLA_AT_RISK_RATIO) slaState = 'at_risk';
    const breachedAt = slaState === 'breached' ? due.resolutionDueAt : null;
    if (breachedAt) {
      timeline.push({ type: 'sla_breached', at: breachedAt, actor: null, actorName: SYSTEM_ACTOR.name, message: 'SLA breached - escalated to admins' });
    }
    timeline.sort((a, b) => a.at.getTime() - b.at.getTime());

    seq += 1;
    const number = `INC-${String(seq).padStart(5, '0')}`;
    const inc = await Incident.create({
      number,
      title,
      description,
      category: tpl.category,
      channel: tpl.channel,
      impact: tpl.impact,
      urgency,
      priority: settled,
      status,
      reporter: reporter._id,
      assignee: assignee?._id ?? null,
      tags: tpl.tags ?? [],
      sla: {
        ...due,
        firstRespondedAt: assignee ? at(firstResponseH) : null,
        responseBreached: !assignee && ageH * 60 > policies[settled].responseMinutes,
        state: slaState,
        breachedAt,
        escalationLevel: slaState === 'breached' ? 1 : 0,
      },
      ai: { ...ai, applied: false, at: createdAt },
      embedding,
      resolution: done ? { summary: fill(tpl.resolution, ctx), resolvedAt: at(ttrH), resolvedBy: assignee!._id } : null,
      closedAt: status === 'closed' ? at(ttrH + 1.5) : null,
      timeline,
      createdAt,
      updatedAt: timeline[timeline.length - 1].at,
    });
    await Incident.collection.updateOne({ _id: inc._id }, { $set: { createdAt, updatedAt: timeline[timeline.length - 1].at } });

    await recordAudit('incident.created', { id: String(reporter._id), name: reporter.name }, { type: 'incident', id: String(inc._id) }, {
      number,
      title,
      priority: settled,
      declaredPriority: declared,
      category: tpl.category,
      ai: { source: ai.source, priority: ai.priority, confidence: ai.priorityConfidence, applied: false },
      seed: true,
    });
    for (const ev of timeline.filter((t) => t.type === 'status')) {
      await recordAudit(`incident.${(ev.data as { transition: string }).transition}`, { id: String(ev.actor), name: ev.actorName ?? '' }, { type: 'incident', id: String(inc._id) }, {
        number,
        from: (ev.data as { from: string }).from,
        to: (ev.data as { to: string }).to,
        at: ev.at.toISOString(),
        seed: true,
      });
    }

    // Conversation on a portion of tickets.
    if (assignee && rand() < 0.6) {
      const comments = [
        { author: assignee._id, body: pick(COMMENTS.agent), internal: false, at: at(firstResponseH + 0.1) },
        ...(rand() < 0.5 ? [{ author: reporter._id, body: pick(COMMENTS.reporter), internal: false, at: at(firstResponseH + 0.5) }] : []),
        ...(rand() < 0.35 ? [{ author: assignee._id, body: pick(COMMENTS.internal), internal: true, at: at(firstResponseH + 0.7) }] : []),
      ].filter((c) => c.at.getTime() < now);
      for (const c of comments) {
        const doc = await Comment.create({ incident: inc._id, author: c.author, body: c.body, internal: c.internal });
        await Comment.collection.updateOne({ _id: doc._id }, { $set: { createdAt: c.at } });
      }
    }

    if (assignee && !done && (slaState === 'at_risk' || slaState === 'breached')) {
      await Notification.create({
        user: assignee._id,
        type: slaState === 'breached' ? 'sla_breached' : 'sla_at_risk',
        title: slaState === 'breached' ? `SLA breached: ${number}` : `${number} is at risk of breaching SLA`,
        body: `${title} (P${settled} ${PRIORITY_LABEL[settled]})`,
        incident: inc._id,
        incidentNumber: number,
      });
    }
    if (seq % 20 === 0) console.log(`  ${seq}/${total}`);
  }

  await Counter.updateOne({ _id: 'incident' }, { $set: { seq } }, { upsert: true });
  await flushAudit();
  await createCheckpoint(String(admin._id));
  const counts = await Incident.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
  console.log('incidents by status:', Object.fromEntries(counts.map((c) => [c._id, c.n])));
  console.log(`audit entries: ${await AuditLog.countDocuments()}`);
  console.log(`\nDemo accounts (password ${DEMO_PASSWORD}):`);
  for (const u of USERS) console.log(`  ${u.role.padEnd(8)} ${u.email}`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});

