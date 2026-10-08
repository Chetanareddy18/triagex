import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { CATEGORIES, CHANNELS, OPEN_STATUSES, SLA_STATES, STATUSES } from '../lib/domain.js';
import { forbidden, notFound } from '../lib/errors.js';
import { authenticate, currentUser, staffOnly } from '../middleware/auth.js';
import { objectId, validate } from '../middleware/validate.js';
import { Incident } from '../models/Incident.js';
import { Comment } from '../models/misc.js';
import {
  acceptAiSuggestion,
  addComment,
  assignIncident,
  autoAssignOne,
  autoAssignQueue,
  canView,
  createIncident,
  findIncidentOr404,
  transitionIncident,
  updateIncident,
  viewModel,
} from '../services/incidents.js';
import { findSimilar, incidentText, triageIncident } from '../services/ml.js';
import { draftPostmortem } from '../services/llm.js';
import { recordAudit } from '../services/audit.js';
import { slaProgress } from '../services/sla.js';

export const incidentsRouter = Router();
incidentsRouter.use(authenticate);

const level = z.coerce.number().int().min(1).max(3) as unknown as z.ZodType<1 | 2 | 3>;
const createSchema = z.object({
  title: z.string().trim().min(5, 'at least 5 characters').max(200),
  description: z.string().trim().max(10_000).default(''),
  category: z.enum(CATEGORIES).optional(),
  channel: z.enum(CHANNELS).default('portal'),
  impact: level.optional(),
  urgency: level.optional(),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(30)).max(10).optional(),
});

const csv = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .string()
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)))
    .optional();

const listQuery = z.object({
  status: csv(STATUSES),
  priority: z
    .string()
    .transform((s) => s.split(',').map(Number))
    .pipe(z.array(z.number().int().min(1).max(4)))
    .optional(),
  category: csv(CATEGORIES),
  sla: csv(SLA_STATES),
  assignee: z.union([z.literal('me'), z.literal('unassigned'), objectId]).optional(),
  reporter: z.union([z.literal('me'), objectId]).optional(),
  open: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(['createdAt', '-createdAt', 'priority', '-priority', 'updatedAt', '-updatedAt', 'sla.resolutionDueAt', '-sla.resolutionDueAt']).default('-createdAt'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

incidentsRouter.get('/', validate({ query: listQuery }), async (req, res) => {
  const user = currentUser(req);
  const q = res.locals.query as z.infer<typeof listQuery>;
  const filter: Record<string, unknown> = {};
  if (user.role === 'reporter') filter.reporter = new Types.ObjectId(user.id);
  else if (q.reporter) filter.reporter = new Types.ObjectId(q.reporter === 'me' ? user.id : q.reporter);
  if (q.status?.length) filter.status = { $in: q.status };
  else if (q.open === 'true') filter.status = { $in: OPEN_STATUSES };
  else if (q.open === 'false') filter.status = { $nin: OPEN_STATUSES };
  if (q.priority?.length) filter.priority = { $in: q.priority };
  if (q.category?.length) filter.category = { $in: q.category };
  if (q.sla?.length) filter['sla.state'] = { $in: q.sla };
  if (q.assignee === 'me') filter.assignee = new Types.ObjectId(user.id);
  else if (q.assignee === 'unassigned') filter.assignee = null;
  else if (q.assignee) filter.assignee = new Types.ObjectId(q.assignee);

  let sort: Record<string, 1 | -1 | { $meta: 'textScore' }> = {};
  const projection: Record<string, number | object> = { timeline: 0, embedding: 0, 'ai.signals': 0 };
  if (q.q) {
    if (/^INC-\d+$/i.test(q.q)) filter.number = q.q.toUpperCase();
    else {
      filter.$text = { $search: q.q };
      projection.score = { $meta: 'textScore' };
      sort.score = { $meta: 'textScore' };
    }
  }
  const field = q.sort.replace(/^-/, '');
  sort = { ...sort, [field]: q.sort.startsWith('-') ? -1 : 1 };
  if (field !== 'createdAt') sort.createdAt = -1;

  const [items, total] = await Promise.all([
    Incident.find(filter)
      .select(projection)
      .sort(sort)
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .populate('assignee', 'name email role')
      .populate('reporter', 'name email'),
    Incident.countDocuments(filter),
  ]);
  const now = new Date();
  res.json({
    items: items.map((i) => ({ ...(i.toJSON() as object), slaProgress: slaProgress(i, now) })),
    total,
    page: q.page,
    limit: q.limit,
    pages: Math.max(1, Math.ceil(total / q.limit)),
  });
});

incidentsRouter.post('/', validate({ body: createSchema }), async (req, res) => {
  const user = currentUser(req);
  const { incident, similar } = await createIncident(res.locals.body as z.infer<typeof createSchema>, user);
  res.status(201).json({ incident: viewModel(incident, user), similar });
});

/** Live triage while the reporter types (nothing is stored). */
incidentsRouter.post(
  '/triage-preview',
  validate({ body: createSchema.extend({ title: z.string().trim().min(3).max(200) }) }),
  async (req, res) => {
    const body = res.locals.body as z.infer<typeof createSchema>;
    const { ai, similar } = await triageIncident({ ...body, impact: body.impact ?? 2, urgency: body.urgency ?? 2, openedAt: new Date() });
    res.json({ ai, similar });
  },
);

incidentsRouter.post('/auto-assign', staffOnly, async (req, res) => {
  res.json(await autoAssignQueue(currentUser(req)));
});

const idParam = validate({ params: z.object({ id: z.string().min(1).max(40) }) });

async function loadVisible(req: Request) {
  const user = currentUser(req);
  const inc = await findIncidentOr404(String(req.params.id));
  if (!canView(user, inc)) throw notFound('Incident'); // do not reveal existence
  return { user, inc };
}

incidentsRouter.get('/:id', idParam, async (req, res) => {
  const { user, inc } = await loadVisible(req);
  const view = viewModel(inc, user);
  await inc.populate([
    { path: 'reporter', select: 'name email role' },
    { path: 'assignee', select: 'name email role' },
    { path: 'resolution.resolvedBy', select: 'name' },
  ]);
  const json = inc.toJSON() as unknown as Record<string, unknown>;
  if (user.role === 'reporter') {
    // Reporters see the outcome, not internal notes or model internals.
    json.timeline = (json.timeline as { type: string }[]).filter((t) => t.type !== 'note');
  }
  res.json({ incident: { ...json, allowedTransitions: view.allowedTransitions, slaProgress: slaProgress(inc) } });
});

const updateSchema = z
  .object({
    title: z.string().trim().min(5).max(200).optional(),
    description: z.string().trim().max(10_000).optional(),
    category: z.enum(CATEGORIES).optional(),
    impact: level.optional(),
    urgency: level.optional(),
    priority: z.coerce.number().int().min(1).max(4).optional() as z.ZodType<1 | 2 | 3 | 4 | undefined>,
    tags: z.array(z.string().trim().toLowerCase().min(1).max(30)).max(10).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'nothing to update');

incidentsRouter.patch('/:id', idParam, validate({ body: updateSchema }), async (req, res) => {
  const { user, inc } = await loadVisible(req);
  const updated = await updateIncident(inc, res.locals.body as z.infer<typeof updateSchema>, user);
  res.json({ incident: viewModel(updated, user) });
});

const transitionSchema = z.object({
  to: z.enum(STATUSES),
  resolutionSummary: z.string().trim().max(5000).optional(),
  note: z.string().trim().max(500).optional(),
});

incidentsRouter.post('/:id/transition', idParam, validate({ body: transitionSchema }), async (req, res) => {
  const { user, inc } = await loadVisible(req);
  const { to, ...opts } = res.locals.body as z.infer<typeof transitionSchema>;
  const updated = await transitionIncident(inc, to, user, opts);
  res.json({ incident: viewModel(updated, user) });
});

const assignSchema = z.union([z.object({ assigneeId: objectId.nullable() }), z.object({ auto: z.literal(true) })]);

incidentsRouter.post('/:id/assign', staffOnly, idParam, validate({ body: assignSchema }), async (req, res) => {
  const { user, inc } = await loadVisible(req);
  const body = res.locals.body as z.infer<typeof assignSchema>;
  const updated = 'auto' in body ? await autoAssignOne(String(inc._id), user) : await assignIncident(inc, body.assigneeId, user);
  res.json({ incident: viewModel(updated, user) });
});

incidentsRouter.post('/:id/accept-ai', staffOnly, idParam, async (req, res) => {
  const { user, inc } = await loadVisible(req);
  const updated = await acceptAiSuggestion(inc, user);
  res.json({ incident: viewModel(updated, user) });
});

incidentsRouter.get('/:id/similar', idParam, async (req, res) => {
  const { inc } = await loadVisible(req);
  const withEmbedding = await Incident.findById(inc._id).select('+embedding').lean();
  const result = await findSimilar({ text: incidentText(inc), embedding: withEmbedding?.embedding }, { excludeId: String(inc._id), limit: 5 });
  res.json(result);
});

incidentsRouter.get('/:id/comments', idParam, async (req, res) => {
  const { user, inc } = await loadVisible(req);
  const filter: Record<string, unknown> = { incident: inc._id };
  if (user.role === 'reporter') filter.internal = false;
  const comments = await Comment.find(filter).sort({ createdAt: 1 }).populate('author', 'name role').lean();
  res.json({
    items: comments.map((c) => ({
      id: String(c._id),
      body: c.body,
      internal: c.internal,
      createdAt: c.createdAt,
      author: c.author ? { id: String((c.author as unknown as { _id: unknown })._id), name: (c.author as unknown as { name: string }).name, role: (c.author as unknown as { role: string }).role } : null,
    })),
  });
});

const commentSchema = z.object({ body: z.string().trim().min(1).max(5000), internal: z.boolean().default(false) });

incidentsRouter.post('/:id/comments', idParam, validate({ body: commentSchema }), async (req, res) => {
  const { user, inc } = await loadVisible(req);
  const { body, internal } = res.locals.body as z.infer<typeof commentSchema>;
  res.status(201).json({ comment: await addComment(inc, user, body, internal) });
});

incidentsRouter.post('/:id/postmortem', staffOnly, idParam, async (req, res) => {
  const { user, inc } = await loadVisible(req);
  if (OPEN_STATUSES.includes(inc.status)) throw forbidden('Postmortems can be drafted once the incident is resolved');
  const comments = await Comment.find({ incident: inc._id }).sort({ createdAt: 1 }).lean();
  const draft = await draftPostmortem(inc, comments);
  inc.postmortem = { ...draft, generatedAt: new Date() };
  await inc.save();
  await recordAudit('incident.postmortem_drafted', user, { type: 'incident', id: String(inc._id) }, { number: inc.number, provider: draft.provider });
  res.json({ postmortem: inc.postmortem });
});
