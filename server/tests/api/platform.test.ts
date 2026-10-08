import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { setIO } from '../../src/services/realtime.js';
import { attachSockets } from '../../src/sockets/index.js';
import { api, app, auth, createIncident, makeUser } from '../helpers.js';

describe('alert ingestion with de-duplication', () => {
  const alert = { source: 'Prometheus', service: 'checkout', title: 'High error rate on checkout-api pod 3', severity: 'critical' };

  it('creates one incident and folds repeats into it', async () => {
    await makeUser('agent');
    const first = await api().post('/api/alerts/ingest').set('x-alert-key', 'test-alert-key').send(alert);
    expect(first.status).toBe(201);
    expect(first.body.deduplicated).toBe(false);

    // Same alert with a different pod number normalises to the same fingerprint.
    const second = await api().post('/api/alerts/ingest').set('x-alert-key', 'test-alert-key').send({ ...alert, title: 'High error rate on checkout-api pod 7' });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ deduplicated: true, incident: { number: first.body.incident.number, occurrences: 2 } });

    const other = await api().post('/api/alerts/ingest').set('x-alert-key', 'test-alert-key').send({ ...alert, title: 'Disk almost full on db-1' });
    expect(other.body.deduplicated).toBe(false);
  });

  it('requires a key or staff token', async () => {
    const reporter = await makeUser('reporter');
    expect((await api().post('/api/alerts/ingest').send(alert)).status).toBe(401);
    expect((await api().post('/api/alerts/ingest').set('x-alert-key', 'wrong').send(alert)).status).toBe(401);
    expect((await api().post('/api/alerts/ingest').set(auth(reporter.token)).send(alert)).status).toBe(401);
  });
});

describe('dashboard', () => {
  it('summarises MTTR, SLA compliance, workload and trend', async () => {
    const reporter = await makeUser('reporter');
    const agent = await makeUser('agent', 'Margaret');
    const a = await createIncident(reporter.token, { impact: 1, urgency: 1 });
    await createIncident(reporter.token, { impact: 2, urgency: 2 });
    for (const [to, extra] of [['assigned', {}], ['in_progress', {}], ['resolved', { resolutionSummary: 'done' }]] as const) {
      await api().post(`/api/incidents/${a.id}/transition`).set(auth(agent.token)).send({ to, ...extra });
    }
    const res = await api().get('/api/dashboard/summary?days=7').set(auth(agent.token));
    expect(res.status).toBe(200);
    expect(res.body.totals).toMatchObject({ createdInWindow: 2, resolvedInWindow: 1, open: 1 });
    expect(res.body.slaCompliance).toBe(100);
    expect(res.body.mttrHours).toBeGreaterThanOrEqual(0);
    expect(res.body.trend).toHaveLength(7);
    expect(res.body.openByPriority.find((p: { priority: number }) => p.priority === 3).count).toBe(1);
    expect(res.body.workload.find((w: { name: string }) => w.name === 'Margaret')).toMatchObject({ resolved: 1, open: 0 });
  });
});

describe('real-time updates', () => {
  let server: Server | undefined;
  const sockets: Socket[] = [];

  afterEach(async () => {
    sockets.splice(0).forEach((s) => s.disconnect());
    setIO(null);
    await new Promise((r) => server?.close(r));
  });

  async function start() {
    server = createServer(app);
    attachSockets(server);
    await new Promise<void>((r) => server!.listen(0, r));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }

  const open = (url: string, token: string) =>
    new Promise<Socket>((resolve, reject) => {
      const s = connect(url, { auth: { token }, transports: ['websocket'], reconnection: false });
      sockets.push(s);
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
    });

  it('rejects sockets without a valid token', async () => {
    const url = await start();
    await expect(open(url, 'garbage')).rejects.toThrow(/unauthorized/);
  });

  it('pushes new incidents to staff and notifications to the assignee', async () => {
    const url = await start();
    const reporter = await makeUser('reporter');
    const agent = await makeUser('agent');
    const admin = await makeUser('admin');
    const agentSocket = await open(url, agent.token);
    const reporterSocket = await open(url, reporter.token);
    let reporterSawOthers = false;
    reporterSocket.on('incident:created', (p: { title: string }) => {
      if (p.title !== 'Socket test incident') reporterSawOthers = true;
    });

    const created = new Promise<{ number: string }>((r) => agentSocket.once('incident:created', r));
    const inc = await createIncident(reporter.token, { title: 'Socket test incident' });
    expect((await created).number).toBe(inc.number);

    const notified = new Promise<{ type: string }>((r) => agentSocket.once('notification:new', r));
    await api().post(`/api/incidents/${inc.id}/assign`).set(auth(admin.token)).send({ assigneeId: agent.id });
    expect((await notified).type).toBe('assigned');

    // Comments reach subscribers of the incident room.
    const subscribed = await new Promise<boolean>((r) => reporterSocket.emit('incident:subscribe', inc.id, r));
    expect(subscribed).toBe(true);
    const comment = new Promise<{ body: string }>((r) => reporterSocket.once('comment:created', r));
    await api().post(`/api/incidents/${inc.id}/comments`).set(auth(agent.token)).send({ body: 'On it' });
    expect((await comment).body).toBe('On it');
    expect(reporterSawOthers).toBe(false);
  });

  it('does not let reporters subscribe to other people’s incidents', async () => {
    const url = await start();
    const owner = await makeUser('reporter');
    const stranger = await makeUser('reporter');
    const inc = await createIncident(owner.token);
    const s = await open(url, stranger.token);
    expect(await new Promise<boolean>((r) => s.emit('incident:subscribe', inc.id, r))).toBe(false);
  });
});

describe('health', () => {
  it('reports mongo up and ml unavailable in tests', async () => {
    const res = await api().get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', mongo: true, ml: { available: false } });
  });
});
