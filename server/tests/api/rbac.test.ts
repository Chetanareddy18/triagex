import { describe, expect, it } from 'vitest';
import { api, auth, createIncident, makeUser } from '../helpers.js';

describe('RBAC', () => {
  it('only admins manage users', async () => {
    const reporter = await makeUser('reporter');
    const agent = await makeUser('agent');
    const admin = await makeUser('admin');
    expect((await api().get('/api/users').set(auth(reporter.token))).status).toBe(403);
    expect((await api().get('/api/users').set(auth(agent.token))).status).toBe(403);
    const list = await api().get('/api/users').set(auth(admin.token));
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(3);

    const created = await api()
      .post('/api/users')
      .set(auth(admin.token))
      .send({ name: 'New Agent', email: 'new.agent@test.dev', password: 'abcdefg1', role: 'agent' });
    expect(created.status).toBe(201);

    const promote = await api().patch(`/api/users/${reporter.id}`).set(auth(admin.token)).send({ role: 'agent' });
    expect(promote.status).toBe(200);
    expect(promote.body.user.role).toBe('agent');
  });

  it('admins cannot demote or disable themselves', async () => {
    const admin = await makeUser('admin');
    const res = await api().patch(`/api/users/${admin.id}`).set(auth(admin.token)).send({ role: 'agent' });
    expect(res.status).toBe(400);
  });

  it('reporters only see their own incidents', async () => {
    const alice = await makeUser('reporter', 'Alice');
    const bob = await makeUser('reporter', 'Bob');
    const agent = await makeUser('agent');
    const inc = await createIncident(alice.token);
    await createIncident(bob.token, { title: 'Printer jammed on floor 3' });

    const aliceList = await api().get('/api/incidents').set(auth(alice.token));
    expect(aliceList.body.total).toBe(1);
    expect((await api().get(`/api/incidents/${inc.id}`).set(auth(bob.token))).status).toBe(404);
    expect((await api().get(`/api/incidents/${inc.number}`).set(auth(alice.token))).status).toBe(200);
    expect((await api().get('/api/incidents').set(auth(agent.token))).body.total).toBe(2);
  });

  it('reporters cannot work tickets, assign or read internal notes', async () => {
    const reporter = await makeUser('reporter');
    const agent = await makeUser('agent');
    const inc = await createIncident(reporter.token);

    const start = await api().post(`/api/incidents/${inc.id}/transition`).set(auth(reporter.token)).send({ to: 'assigned' });
    expect(start.status).toBe(403);
    const assign = await api().post(`/api/incidents/${inc.id}/assign`).set(auth(reporter.token)).send({ assigneeId: agent.id });
    expect(assign.status).toBe(403);
    const note = await api().post(`/api/incidents/${inc.id}/comments`).set(auth(reporter.token)).send({ body: 'x', internal: true });
    expect(note.status).toBe(403);

    await api().post(`/api/incidents/${inc.id}/comments`).set(auth(agent.token)).send({ body: 'internal only', internal: true });
    await api().post(`/api/incidents/${inc.id}/comments`).set(auth(agent.token)).send({ body: 'public reply' });
    const seenByReporter = await api().get(`/api/incidents/${inc.id}/comments`).set(auth(reporter.token));
    expect(seenByReporter.body.items.map((c: { body: string }) => c.body)).toEqual(['public reply']);
    const seenByAgent = await api().get(`/api/incidents/${inc.id}/comments`).set(auth(agent.token));
    expect(seenByAgent.body.items).toHaveLength(2);
  });

  it('audit log and SLA policy changes are admin-only', async () => {
    const agent = await makeUser('agent');
    const admin = await makeUser('admin');
    expect((await api().get('/api/audit/verify').set(auth(agent.token))).status).toBe(403);
    expect((await api().get('/api/audit/verify').set(auth(admin.token))).status).toBe(200);
    const body = { policies: [{ priority: 1, responseMinutes: 10, resolutionMinutes: 120 }] };
    expect((await api().put('/api/sla/policies').set(auth(agent.token)).send(body)).status).toBe(403);
    const ok = await api().put('/api/sla/policies').set(auth(admin.token)).send(body);
    expect(ok.status).toBe(200);
    expect(ok.body.policies[0]).toMatchObject({ priority: 1, responseMinutes: 10, resolutionMinutes: 120 });
  });
});
