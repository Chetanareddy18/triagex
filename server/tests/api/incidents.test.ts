import { afterEach, describe, expect, it, vi } from 'vitest';
import { Incident } from '../../src/models/Incident.js';
import { Notification } from '../../src/models/misc.js';
import { api, auth, createIncident, makeUser } from '../helpers.js';

describe('incidents', () => {
  afterEach(() => vi.restoreAllMocks());

  it('creates with fallback triage when the ML service is down', async () => {
    const reporter = await makeUser('reporter');
    const res = await api()
      .post('/api/incidents')
      .set(auth(reporter.token))
      .send({ title: 'Checkout outage for all users', description: 'Payments failing', impact: 1, urgency: 1, channel: 'portal' });
    expect(res.status).toBe(201);
    const inc = res.body.incident;
    expect(inc.number).toMatch(/^INC-\d{5}$/);
    expect(inc.status).toBe('new');
    expect(inc.priority).toBe(1);
    expect(inc.ai.source).toBe('fallback');
    expect(inc.sla.state).toBe('on_track');
    expect(new Date(inc.sla.resolutionDueAt).getTime() - new Date(inc.createdAt).getTime()).toBe(4 * 3_600_000);
    expect(inc.embedding).toBeUndefined();
    expect(inc.timeline.map((t: { type: string }) => t.type)).toEqual(['created', 'ai_triage']);
  });

  it('uses the ML service when available and auto-applies a confident priority', async () => {
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (!url.startsWith('http://127.0.0.1:9')) return realFetch(input, init);
      if (url.endsWith('/embed')) return Response.json({ model: 'test-model', dim: 3, vectors: [[1, 0, 0]] });
      if (url.endsWith('/triage'))
        return Response.json({
          priority: 2,
          priorityConfidence: 0.82,
          priorityDistribution: [0.1, 0.82, 0.05, 0.03],
          category: 'network',
          categoryConfidence: 0.7,
          breachRisk: 0.41,
          expectedResolutionHours: 6.5,
          signals: {},
          modelVersion: 'test',
        });
      return new Response('not found', { status: 404 });
    });
    const reporter = await makeUser('reporter');
    const inc = await createIncident(reporter.token, { impact: 2, urgency: 2 });
    expect(inc.priority).toBe(2); // declared P3 (2x2), AI confident -> P2
    expect(inc.category).toBe('network');
    expect(inc.ai).toMatchObject({ source: 'ml', applied: true, breachRisk: 0.41 });
    const stored = await Incident.findById(inc.id).select('+embedding').lean();
    expect(stored?.embedding).toMatchObject({ model: 'test-model', vector: [1, 0, 0] });
  });

  it('validates input', async () => {
    const reporter = await makeUser('reporter');
    const res = await api().post('/api/incidents').set(auth(reporter.token)).send({ title: 'no', impact: 7 });
    expect(res.status).toBe(400);
    expect(res.body.error.details.issues.map((i: { path: string }) => i.path)).toEqual(expect.arrayContaining(['title', 'impact']));
  });

  it('lists with filters, sorting, pagination and full-text search', async () => {
    const reporter = await makeUser('reporter');
    const agent = await makeUser('agent');
    await createIncident(reporter.token, { title: 'Database replication lag on reporting cluster', impact: 1, urgency: 2 });
    await createIncident(reporter.token, { title: 'Outlook keeps asking for password', impact: 3, urgency: 3 });
    await createIncident(reporter.token, { title: 'Laptop battery swelling', impact: 2, urgency: 2 });

    const p = await api().get('/api/incidents?priority=4').set(auth(agent.token));
    expect(p.body.items.map((i: { title: string }) => i.title)).toEqual(['Outlook keeps asking for password']);

    const page = await api().get('/api/incidents?limit=2&page=2&sort=priority').set(auth(agent.token));
    expect(page.body).toMatchObject({ total: 3, page: 2, pages: 2 });
    expect(page.body.items).toHaveLength(1);
    expect(page.body.items[0].priority).toBe(4);

    const search = await api().get('/api/incidents?q=replication').set(auth(agent.token));
    expect(search.body.items).toHaveLength(1);
    expect(search.body.items[0].title).toMatch(/replication/);

    const bad = await api().get('/api/incidents?status=bogus').set(auth(agent.token));
    expect(bad.status).toBe(400);
  });

  it('runs the full lifecycle with validated transitions', async () => {
    const reporter = await makeUser('reporter');
    const agent = await makeUser('agent', 'Linus');
    const inc = await createIncident(reporter.token);
    const move = (to: string, extra: Record<string, unknown> = {}, token = agent.token) =>
      api().post(`/api/incidents/${inc.id}/transition`).set(auth(token)).send({ to, ...extra });

    const skip = await move('resolved');
    expect(skip.status).toBe(422);
    expect(skip.body.error).toMatchObject({ code: 'INVALID_TRANSITION', details: { from: 'new', allowed: ['assigned'] } });

    const assigned = await move('assigned');
    expect(assigned.body.incident).toMatchObject({ status: 'assigned', assignee: agent.id });
    expect(assigned.body.incident.sla.firstRespondedAt).toBeTruthy();
    expect((await move('in_progress')).body.incident.status).toBe('in_progress');

    const noSummary = await move('resolved');
    expect(noSummary.status).toBe(400);
    const resolved = await move('resolved', { resolutionSummary: 'Rotated the VPN gateway certificate' });
    expect(resolved.body.incident).toMatchObject({ status: 'resolved', resolution: { summary: 'Rotated the VPN gateway certificate' } });
    expect(resolved.body.incident.sla.state).toBe('met');

    // Reporter can reopen their own resolved ticket...
    const reopened = await move('assigned', {}, reporter.token);
    expect(reopened.status).toBe(200);
    expect(reopened.body.incident).toMatchObject({ status: 'assigned', reopenCount: 1, resolution: null });

    await move('in_progress');
    await move('resolved', { resolutionSummary: 'Replaced gateway' });
    // ...and confirm/close it.
    const closed = await move('closed', {}, reporter.token);
    expect(closed.body.incident.status).toBe('closed');
    expect(closed.body.incident.allowedTransitions).toEqual(['assigned']);

    const detail = await api().get(`/api/incidents/${inc.id}`).set(auth(agent.token));
    const statusEvents = detail.body.incident.timeline.filter((t: { type: string }) => t.type === 'status');
    expect(statusEvents.map((e: { data: { transition: string } }) => e.data.transition)).toEqual([
      'assign',
      'start',
      'resolve',
      'reopen',
      'start',
      'resolve',
      'close',
    ]);
    // the reporter was notified about status changes made by the agent
    expect(await Notification.countDocuments({ user: reporter.id, type: 'status' })).toBeGreaterThan(0);
  });

  it('assigns manually and recomputes SLA on priority change', async () => {
    const reporter = await makeUser('reporter');
    const agent = await makeUser('agent');
    const inc = await createIncident(reporter.token, { impact: 3, urgency: 3 });
    expect(inc.priority).toBe(4);

    const assigned = await api().post(`/api/incidents/${inc.id}/assign`).set(auth(agent.token)).send({ assigneeId: agent.id });
    expect(assigned.body.incident).toMatchObject({ status: 'assigned', assignee: agent.id });
    expect(await Notification.countDocuments({ user: agent.id, type: 'assigned' })).toBe(0); // self-assignment: no self-notification

    const bump = await api().patch(`/api/incidents/${inc.id}`).set(auth(agent.token)).send({ priority: 1 });
    expect(bump.status).toBe(200);
    const span = new Date(bump.body.incident.sla.resolutionDueAt).getTime() - new Date(bump.body.incident.createdAt).getTime();
    expect(span).toBe(4 * 3_600_000);
  });

  it('smart-assigns the queue to the least-loaded agents', async () => {
    const reporter = await makeUser('reporter');
    const busy = await makeUser('agent', 'Busy');
    const idle = await makeUser('agent', 'Idle');
    // Busy already owns a P1 (weight 8).
    const existing = await createIncident(reporter.token, { title: 'Existing critical issue', impact: 1, urgency: 1 });
    await api().post(`/api/incidents/${existing.id}/assign`).set(auth(busy.token)).send({ assigneeId: busy.id });

    await createIncident(reporter.token, { title: 'Second critical issue', impact: 1, urgency: 1 });
    await createIncident(reporter.token, { title: 'Minor cosmetic glitch', impact: 3, urgency: 3 });

    const res = await api().post('/api/incidents/auto-assign').set(auth(busy.token));
    expect(res.status).toBe(200);
    expect(res.body.assigned).toBe(2);
    // Most urgent first -> to Idle (load 0); then Idle has 8 == Busy 8, tie broken by open count -> Busy has 1, Idle has 1 -> least recently assigned
    expect(res.body.plan[0]).toMatchObject({ agent: 'Idle', loadBefore: 0 });
    const idleOpen = await Incident.countDocuments({ assignee: idle.id });
    expect(idleOpen).toBeGreaterThanOrEqual(1);
    expect(await Incident.countDocuments({ assignee: null })).toBe(0);
  });

  it('reporters may edit only the wording of their own new tickets', async () => {
    const reporter = await makeUser('reporter');
    const inc = await createIncident(reporter.token);
    expect((await api().patch(`/api/incidents/${inc.id}`).set(auth(reporter.token)).send({ title: 'VPN drops every 5 minutes' })).status).toBe(200);
    expect((await api().patch(`/api/incidents/${inc.id}`).set(auth(reporter.token)).send({ priority: 1 })).status).toBe(403);
  });

  it('drafts a template postmortem without an LLM key', async () => {
    const reporter = await makeUser('reporter');
    const agent = await makeUser('agent');
    const inc = await createIncident(reporter.token);
    const early = await api().post(`/api/incidents/${inc.id}/postmortem`).set(auth(agent.token));
    expect(early.status).toBe(403);
    for (const [to, extra] of [['assigned', {}], ['in_progress', {}], ['resolved', { resolutionSummary: 'Fixed MTU' }]] as const) {
      await api().post(`/api/incidents/${inc.id}/transition`).set(auth(agent.token)).send({ to, ...extra });
    }
    const pm = await api().post(`/api/incidents/${inc.id}/postmortem`).set(auth(agent.token));
    expect(pm.status).toBe(200);
    expect(pm.body.postmortem.provider).toBe('template');
    expect(pm.body.postmortem.draft).toContain(`# Postmortem: ${inc.number}`);
    expect(pm.body.postmortem.draft).toContain('Fixed MTU');
  });

  it('returns similar incidents via text search fallback', async () => {
    const reporter = await makeUser('reporter');
    const a = await createIncident(reporter.token, { title: 'VPN tunnel drops for remote staff', description: 'tunnel resets' });
    await createIncident(reporter.token, { title: 'VPN tunnel unstable since upgrade', description: 'after client upgrade' });
    await createIncident(reporter.token, { title: 'Coffee machine broken', description: 'kitchen on floor 2' });
    const res = await api().get(`/api/incidents/${a.id}/similar`).set(auth(reporter.token));
    expect(res.body.method).toBe('text');
    expect(res.body.items.map((i: { title: string }) => i.title)).toContain('VPN tunnel unstable since upgrade');
    expect(res.body.items.map((i: { title: string }) => i.title)).not.toContain('Coffee machine broken');
  });
});
