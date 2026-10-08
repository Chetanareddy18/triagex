import { describe, expect, it } from 'vitest';
import { Incident } from '../../src/models/Incident.js';
import { Notification } from '../../src/models/misc.js';
import { autoAssignOne } from '../../src/services/incidents.js';
import { runSlaScan } from '../../src/services/sla.js';
import { api, auth, createIncident, makeUser } from '../helpers.js';

const HOUR = 3_600_000;

describe('SLA engine', () => {
  it('flags at-risk, then breaches and escalates exactly once', async () => {
    const reporter = await makeUser('reporter');
    const agent = await makeUser('agent');
    const admin = await makeUser('admin');
    const inc = await createIncident(reporter.token, { impact: 2, urgency: 1 }); // P2: 8h
    expect(inc.priority).toBe(2);
    await api().post(`/api/incidents/${inc.id}/assign`).set(auth(admin.token)).send({ assigneeId: agent.id });
    const created = new Date(inc.createdAt as string).getTime();

    const early = await runSlaScan(new Date(created + 1 * HOUR));
    expect(early.atRisk).toBe(0);

    const risk = await runSlaScan(new Date(created + 6.5 * HOUR)); // 81% of 8h
    expect(risk.atRisk).toBe(1);
    expect((await Incident.findById(inc.id))!.sla.state).toBe('at_risk');
    expect(await Notification.countDocuments({ user: agent.id, type: 'sla_at_risk' })).toBe(1);

    const breach = await runSlaScan(new Date(created + 9 * HOUR));
    expect(breach).toMatchObject({ breached: 1, escalated: 1 });
    const after = (await Incident.findById(inc.id))!;
    expect(after.sla.state).toBe('breached');
    expect(after.priority).toBe(1); // escalated one level
    expect(after.sla.escalationLevel).toBe(1);
    expect(after.timeline.some((t) => t.type === 'sla_breached')).toBe(true);
    expect(await Notification.countDocuments({ user: admin.id, type: 'sla_breached' })).toBe(1);
    expect(await Notification.countDocuments({ user: agent.id, type: 'sla_breached' })).toBe(1);

    // Idempotent: scanning again does nothing new.
    const again = await runSlaScan(new Date(created + 10 * HOUR));
    expect(again).toMatchObject({ atRisk: 0, breached: 0 });
    expect(await Notification.countDocuments({ type: 'sla_breached' })).toBe(2);
  });

  it('auto-assigns unassigned incidents on breach and records response breaches', async () => {
    const reporter = await makeUser('reporter');
    const agent = await makeUser('agent', 'On Call');
    const inc = await createIncident(reporter.token, { impact: 3, urgency: 3 }); // P4: 72h
    const created = new Date(inc.createdAt as string).getTime();

    const response = await runSlaScan(new Date(created + 9 * HOUR), (id) => autoAssignOne(id));
    expect(response.responseBreached).toBe(1);
    expect((await Incident.findById(inc.id))!.sla.responseBreached).toBe(true);

    await runSlaScan(new Date(created + 73 * HOUR), (id) => autoAssignOne(id));
    const after = (await Incident.findById(inc.id))!;
    expect(after.sla.state).toBe('breached');
    expect(after.priority).toBe(3);
    expect(String(after.assignee)).toBe(agent.id);
    expect(after.status).toBe('assigned');
  });

  it('marks late resolutions as breached and on-time ones as met', async () => {
    const reporter = await makeUser('reporter');
    const agent = await makeUser('agent');
    const inc = await createIncident(reporter.token);
    await Incident.updateOne({ _id: inc.id }, { 'sla.resolutionDueAt': new Date(Date.now() - 1000) });
    for (const [to, extra] of [['assigned', {}], ['in_progress', {}], ['resolved', { resolutionSummary: 'late fix' }]] as const) {
      await api().post(`/api/incidents/${inc.id}/transition`).set(auth(agent.token)).send({ to, ...extra });
    }
    const after = (await Incident.findById(inc.id))!;
    expect(after.sla.state).toBe('breached');
    expect(after.sla.breachedAt).toBeTruthy();
  });

  it('exposes policies and a manual scan endpoint', async () => {
    const agent = await makeUser('agent');
    const policies = await api().get('/api/sla/policies').set(auth(agent.token));
    expect(policies.body.policies).toHaveLength(4);
    expect(policies.body.policies[0]).toMatchObject({ priority: 1, resolutionMinutes: 240 });
    const scan = await api().post('/api/sla/scan').set(auth(agent.token));
    expect(scan.status).toBe(200);
    expect(scan.body).toHaveProperty('scanned');
  });
});
