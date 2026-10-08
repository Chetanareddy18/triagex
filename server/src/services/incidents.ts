import { Types } from 'mongoose';
import { env } from '../config/env.js';
import { itilPriority, OPEN_STATUSES, type Category, type Channel, type Priority, type Role, type Status } from '../lib/domain.js';
import { badRequest, forbidden, invalidTransition, notFound } from '../lib/errors.js';
import { allowedTransitions, roleCanTransition, transitionName, TRANSITIONS } from '../lib/stateMachine.js';
import { Incident, type IncidentDoc, type TimelineEvent } from '../models/Incident.js';
import { Comment, nextSequence } from '../models/misc.js';
import { User } from '../models/User.js';
import { planAssignments, currentAgentLoads, pickAgent } from './assignment.js';
import { recordAudit, SYSTEM_ACTOR, type Actor } from './audit.js';
import { triageIncident } from './ml.js';
import { notify } from './notifications.js';
import { emitIncident, emitTo, rooms } from './realtime.js';
import { computeDueDates, evaluateSla, loadPolicies } from './sla.js';

export interface RequestUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

const asActor = (u: RequestUser | Actor): Actor => ({ id: u.id, name: u.name });
const isStaff = (u: RequestUser) => u.role === 'agent' || u.role === 'admin';

/** Id of a ref that may or may not be populated. */
export const idOf = (ref: unknown): string | null =>
  ref == null ? null : typeof ref === 'object' && '_id' in (ref as object) ? String((ref as { _id: unknown })._id) : String(ref);

export function canView(user: RequestUser, incident: { reporter: unknown; assignee?: unknown }): boolean {
  return isStaff(user) || idOf(incident.reporter) === user.id;
}

function event(type: string, actor: Actor, message: string, data?: Record<string, unknown>): TimelineEvent {
  return {
    type,
    at: new Date(),
    actor: actor.id === 'system' ? null : new Types.ObjectId(actor.id),
    actorName: actor.name,
    message,
    data,
  };
}

/** Lean, client-facing summary used for socket payloads. */
export function summary(inc: IncidentDoc) {
  return {
    id: String(inc._id),
    number: inc.number,
    title: inc.title,
    status: inc.status,
    priority: inc.priority,
    category: inc.category,
    assignee: inc.assignee ? String(inc.assignee) : null,
    slaState: inc.sla.state,
    updatedAt: inc.updatedAt,
  };
}

export async function findIncidentOr404(idOrNumber: string): Promise<IncidentDoc> {
  const query = Types.ObjectId.isValid(idOrNumber) ? { _id: idOrNumber } : { number: idOrNumber.toUpperCase() };
  const inc = await Incident.findOne(query);
  if (!inc) throw notFound('Incident');
  return inc;
}

// --------------------------------------------------------------------------- create
export interface CreateInput {
  title: string;
  description?: string;
  category?: Category;
  channel?: Channel;
  impact?: 1 | 2 | 3;
  urgency?: 1 | 2 | 3;
  tags?: string[];
  fingerprint?: string;
}

export async function createIncident(input: CreateInput, user: RequestUser | (Actor & { role: Role })) {
  const actor = asActor(user);
  const impact = input.impact ?? 2;
  const urgency = input.urgency ?? 2;
  const declared = itilPriority(impact, urgency);
  const now = new Date();

  const { ai, embedding, similar } = await triageIncident({ ...input, impact, urgency, openedAt: now });
  const apply = ai.priorityConfidence >= env.AI_AUTO_APPLY_CONFIDENCE && ai.priority !== declared;
  const priority: Priority = apply ? ai.priority : declared;
  const category = input.category ?? (ai.categoryConfidence >= 0.35 ? ai.category : 'other');

  const policies = await loadPolicies();
  const due = computeDueDates(now, priority, policies);
  const seq = await nextSequence('incident');
  const number = `INC-${String(seq).padStart(5, '0')}`;

  const timeline: TimelineEvent[] = [event('created', actor, `Incident reported via ${input.channel ?? 'portal'}`)];
  timeline.push({
    ...event(
      'ai_triage',
      SYSTEM_ACTOR,
      apply
        ? `AI triage set priority P${priority} (declared P${declared}, confidence ${Math.round(ai.priorityConfidence * 100)}%)`
        : `AI triage suggests P${ai.priority} / ${ai.category} (confidence ${Math.round(ai.priorityConfidence * 100)}%)`,
      { source: ai.source, priority: ai.priority, confidence: ai.priorityConfidence, applied: apply },
    ),
  });

  const incident = await Incident.create({
    number,
    createdAt: now, // SLA windows are computed from this exact instant
    title: input.title,
    description: input.description ?? '',
    category,
    channel: input.channel ?? 'portal',
    impact,
    urgency,
    priority,
    reporter: new Types.ObjectId(actor.id),
    tags: input.tags ?? [],
    fingerprint: input.fingerprint ?? null,
    lastOccurrenceAt: input.fingerprint ? now : null,
    sla: { ...due, state: 'on_track', escalationLevel: 0, responseBreached: false },
    ai: { ...ai, applied: apply, at: now },
    embedding,
    timeline,
  });

  await recordAudit('incident.created', actor, { type: 'incident', id: String(incident._id) }, {
    number,
    title: incident.title,
    priority,
    declaredPriority: declared,
    category,
    ai: { source: ai.source, priority: ai.priority, confidence: ai.priorityConfidence, applied: apply },
  });
  emitIncident('incident:created', incident, summary(incident));
  return { incident, similar };
}

// --------------------------------------------------------------------------- update
export interface UpdateInput {
  title?: string;
  description?: string;
  category?: Category;
  impact?: 1 | 2 | 3;
  urgency?: 1 | 2 | 3;
  priority?: Priority;
  tags?: string[];
}

export async function updateIncident(inc: IncidentDoc, input: UpdateInput, user: RequestUser) {
  const owner = String(inc.reporter) === user.id;
  if (!isStaff(user)) {
    // Reporters can only fix the wording of their own ticket before it is picked up.
    const allowedKeys = ['title', 'description'];
    if (!owner || inc.status !== 'new' || Object.keys(input).some((k) => !allowedKeys.includes(k))) throw forbidden();
  }
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(input) as (keyof UpdateInput)[]) {
    const to = input[key];
    const from = inc[key];
    if (to === undefined || JSON.stringify(from) === JSON.stringify(to)) continue;
    changes[key] = { from, to };
    inc.set(key, to);
  }
  if (Object.keys(changes).length === 0) return inc;

  if (changes.priority && OPEN_STATUSES.includes(inc.status)) {
    const due = computeDueDates(inc.createdAt, inc.priority, await loadPolicies());
    inc.sla.responseDueAt = due.responseDueAt;
    inc.sla.resolutionDueAt = due.resolutionDueAt;
    inc.sla.state = evaluateSla({ ...inc.toObject(), sla: { ...inc.sla, state: inc.sla.state === 'breached' ? 'breached' : 'on_track' } }, new Date());
  }
  const pretty = Object.entries(changes)
    .map(([k, v]) => (k === 'description' ? 'description' : `${k} ${fmt(v.from)} -> ${fmt(v.to)}`))
    .join(', ');
  inc.timeline.push(event('updated', asActor(user), `Updated ${pretty}`, { fields: Object.keys(changes) }));
  await inc.save();
  await recordAudit('incident.updated', asActor(user), { type: 'incident', id: String(inc._id) }, { number: inc.number, changes });
  emitIncident('incident:updated', inc, summary(inc));
  return inc;
}

const fmt = (v: unknown) => (typeof v === 'number' ? v : Array.isArray(v) ? `[${v.join(', ')}]` : `"${String(v)}"`);

// --------------------------------------------------------------------------- transitions
export async function transitionIncident(
  inc: IncidentDoc,
  to: Status,
  user: RequestUser,
  opts: { resolutionSummary?: string; note?: string } = {},
) {
  const from = inc.status;
  const name = transitionName(from, to);
  if (!name) throw invalidTransition(from, to, TRANSITIONS[from]);
  const owner = String(inc.reporter) === user.id;
  if (!roleCanTransition(user.role, name, owner)) {
    throw forbidden(`Your role cannot ${name} this incident`);
  }
  const now = new Date();
  const actor = asActor(user);

  switch (name) {
    case 'assign':
      if (!inc.assignee) {
        if (user.role === 'agent') inc.assignee = new Types.ObjectId(user.id);
        else throw badRequest('Choose an assignee before moving to "assigned"');
      }
      break;
    case 'unassign':
      inc.assignee = null;
      break;
    case 'start':
      if (!inc.assignee) inc.assignee = new Types.ObjectId(user.id);
      break;
    case 'resolve': {
      const text = opts.resolutionSummary?.trim();
      if (!text) throw badRequest('A resolution summary is required to resolve an incident');
      inc.resolution = { summary: text, resolvedAt: now, resolvedBy: new Types.ObjectId(user.id) };
      inc.sla.state = now > inc.sla.resolutionDueAt || inc.sla.state === 'breached' ? 'breached' : 'met';
      if (inc.sla.state === 'breached' && !inc.sla.breachedAt) inc.sla.breachedAt = now;
      break;
    }
    case 'close':
      inc.closedAt = now;
      break;
    case 'reopen':
      if (!inc.assignee) throw badRequest('Cannot reopen an incident that was never assigned');
      inc.reopenCount += 1;
      inc.resolution = null;
      inc.closedAt = null;
      inc.sla.state = evaluateSla({ status: 'assigned', createdAt: inc.createdAt, sla: { ...inc.sla, state: inc.sla.breachedAt ? 'breached' : 'on_track' } }, now);
      break;
    case 'handback':
      break;
  }
  if ((name === 'assign' || name === 'start') && !inc.sla.firstRespondedAt) inc.sla.firstRespondedAt = now;

  inc.status = to;
  const label: Record<string, string> = {
    assign: 'Assigned',
    unassign: 'Returned to queue',
    start: 'Work started',
    handback: 'Handed back',
    resolve: 'Resolved',
    close: 'Closed',
    reopen: 'Reopened',
  };
  inc.timeline.push(
    event('status', actor, `${label[name]}${opts.note ? `: ${opts.note}` : ''}`, { from, to, transition: name }),
  );
  await inc.save();

  await recordAudit(`incident.${name}`, actor, { type: 'incident', id: String(inc._id) }, {
    number: inc.number,
    from,
    to,
    ...(name === 'resolve' ? { resolutionSummary: inc.resolution?.summary, sla: inc.sla.state } : {}),
  });

  const watchers = [String(inc.reporter), inc.assignee ? String(inc.assignee) : null];
  await notify(
    watchers,
    { type: 'status', title: `${inc.number} ${label[name].toLowerCase()}`, body: inc.title, incident: inc },
    user.id,
  );
  emitIncident('incident:updated', inc, summary(inc));
  return inc;
}

// --------------------------------------------------------------------------- assignment
export async function assignIncident(inc: IncidentDoc, assigneeId: string | null, user: RequestUser | Actor, reason = 'manual') {
  const actor = asActor(user);
  if (!OPEN_STATUSES.includes(inc.status)) throw badRequest('Only open incidents can be assigned');
  let assignee: { _id: Types.ObjectId; name: string } | null = null;
  if (assigneeId) {
    const u = await User.findOne({ _id: assigneeId, role: { $in: ['agent', 'admin'] }, active: true }, { name: 1 }).lean();
    if (!u) throw badRequest('Assignee must be an active agent or admin');
    assignee = { _id: u._id, name: u.name };
  }
  const previous = inc.assignee ? String(inc.assignee) : null;
  if (previous === (assignee ? String(assignee._id) : null)) return inc;

  inc.assignee = assignee?._id ?? null;
  const from = inc.status;
  if (assignee && inc.status === 'new') inc.status = 'assigned';
  if (!assignee && inc.status !== 'new') inc.status = 'new';
  if (assignee && !inc.sla.firstRespondedAt) inc.sla.firstRespondedAt = new Date();

  inc.timeline.push(
    event(
      'assignment',
      actor,
      assignee ? `Assigned to ${assignee.name}${reason !== 'manual' ? ` (${reason})` : ''}` : 'Unassigned',
      { from: previous, to: assignee ? String(assignee._id) : null, reason, statusFrom: from, statusTo: inc.status },
    ),
  );
  await inc.save();
  await recordAudit('incident.assigned', actor, { type: 'incident', id: String(inc._id) }, {
    number: inc.number,
    from: previous,
    to: assignee ? String(assignee._id) : null,
    reason,
  });
  if (assignee) {
    await notify(
      [String(assignee._id)],
      { type: 'assigned', title: `${inc.number} assigned to you`, body: `P${inc.priority} - ${inc.title}`, incident: inc },
      actor.id,
    );
  }
  emitIncident('incident:updated', inc, summary(inc));
  return inc;
}

export async function autoAssignOne(incidentId: string, actor: Actor = SYSTEM_ACTOR) {
  const inc = await findIncidentOr404(incidentId);
  if (inc.assignee) return inc;
  const agent = await pickAgent();
  if (!agent) return inc;
  return assignIncident(inc, agent.id, actor, `smart assignment, load ${agent.load}`);
}

/** Assigns every unassigned open incident using the priority-queue planner. */
export async function autoAssignQueue(user: RequestUser | Actor) {
  const queue = await Incident.find({ status: 'new', assignee: null }).select('priority sla.resolutionDueAt').lean();
  const agents = await currentAgentLoads();
  const plan = planAssignments(
    queue.map((q) => ({ id: String(q._id), priority: q.priority, dueAt: q.sla.resolutionDueAt.getTime() })),
    agents,
  );
  const results = [];
  for (const step of plan) {
    const inc = await Incident.findById(step.incidentId);
    if (!inc || inc.assignee) continue;
    await assignIncident(inc, step.agentId, user, `smart assignment, load ${step.loadBefore}`);
    results.push({ incident: inc.number, agent: step.agentName, loadBefore: step.loadBefore });
  }
  return { assigned: results.length, plan: results };
}

// --------------------------------------------------------------------------- comments
export async function addComment(inc: IncidentDoc, user: RequestUser, body: string, internal: boolean) {
  if (internal && !isStaff(user)) throw forbidden('Only staff can add internal notes');
  const comment = await Comment.create({ incident: inc._id, author: user.id, body, internal });
  if (isStaff(user) && !inc.sla.firstRespondedAt && !internal) inc.sla.firstRespondedAt = new Date();
  inc.timeline.push(event(internal ? 'note' : 'comment', asActor(user), internal ? 'Added an internal note' : 'Commented', { commentId: String(comment._id) }));
  await inc.save();
  await recordAudit('comment.created', asActor(user), { type: 'incident', id: String(inc._id) }, {
    number: inc.number,
    commentId: String(comment._id),
    internal,
    length: body.length,
  });
  const payload = { ...comment.toJSON(), author: { id: user.id, name: user.name, role: user.role }, incidentId: String(inc._id) };
  emitTo(internal ? rooms.incidentStaff(String(inc._id)) : rooms.incident(String(inc._id)), 'comment:created', payload);
  const watchers = internal ? [inc.assignee ? String(inc.assignee) : null] : [String(inc.reporter), inc.assignee ? String(inc.assignee) : null];
  await notify(watchers, { type: 'comment', title: `New ${internal ? 'note' : 'comment'} on ${inc.number}`, body: body.slice(0, 140), incident: inc }, user.id);
  return payload;
}

export async function acceptAiSuggestion(inc: IncidentDoc, user: RequestUser) {
  if (!inc.ai) throw badRequest('No AI suggestion for this incident');
  const updated = await updateIncident(inc, { priority: inc.ai.priority, category: inc.ai.category }, user);
  updated.ai = { ...updated.ai!, applied: true };
  updated.markModified('ai');
  await updated.save();
  return updated;
}

export function viewModel(inc: IncidentDoc, user: RequestUser) {
  const owner = idOf(inc.reporter) === user.id;
  const json = inc.toJSON() as unknown as Record<string, unknown>;
  return { ...json, allowedTransitions: allowedTransitions(inc.status, user.role, owner) };
}
