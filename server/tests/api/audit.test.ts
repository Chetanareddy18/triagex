import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { AuditLog } from '../../src/models/AuditLog.js';
import { computeHash, flushAudit, GENESIS_HASH, recordAudit, verifyChain } from '../../src/services/audit.js';
import { api, auth, createIncident, makeUser } from '../helpers.js';

const raw = () => mongoose.connection.db!.collection('auditlogs');

async function seedChain(n = 6) {
  for (let i = 0; i < n; i++) {
    await recordAudit('test.event', { id: 'u1', name: 'Tester' }, { type: 'incident', id: `inc-${i}` }, { i, note: `entry ${i}` });
  }
}

describe('hash-chained audit log', () => {
  it('links every entry to its predecessor', async () => {
    await seedChain(5);
    const entries = await AuditLog.find().sort({ seq: 1 }).lean();
    expect(entries.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(entries[0].prevHash).toBe(GENESIS_HASH);
    for (let i = 1; i < entries.length; i++) expect(entries[i].prevHash).toBe(entries[i - 1].hash);
    for (const e of entries) expect(computeHash(e)).toBe(e.hash);
    expect(await verifyChain()).toMatchObject({ ok: true, checked: 5, headSeq: 5, headHash: entries[4].hash });
  });

  it('keeps a linear chain under concurrent writes', async () => {
    await Promise.all(Array.from({ length: 25 }, (_, i) => recordAudit('burst', { id: 'u', name: 'U' }, { type: 't', id: String(i) }, { i })));
    await flushAudit();
    const result = await verifyChain();
    expect(result).toMatchObject({ ok: true, checked: 25 });
  });

  it('detects a tampered payload and pinpoints the first bad entry', async () => {
    await seedChain(6);
    // Simulate someone with database access editing history directly.
    await raw().updateOne({ seq: 3 }, { $set: { 'payload.note': 'nothing to see here' } });
    await raw().updateOne({ seq: 5 }, { $set: { actor: 'someone-else' } });
    const result = await verifyChain();
    expect(result.ok).toBe(false);
    expect(result.firstInvalid).toMatchObject({ seq: 3, reason: 'hash_mismatch' });
    expect(result.checked).toBe(2);
  });

  it('detects a recomputed hash because the next link breaks', async () => {
    await seedChain(4);
    const victim = (await AuditLog.findOne({ seq: 2 }).lean())!;
    const forged = { ...victim, payload: { i: 1, note: 'forged' } };
    await raw().updateOne({ seq: 2 }, { $set: { payload: forged.payload, hash: computeHash(forged) } });
    const result = await verifyChain();
    expect(result.firstInvalid).toMatchObject({ seq: 3, reason: 'broken_link' });
  });

  it('detects deleted entries', async () => {
    await seedChain(5);
    await raw().deleteOne({ seq: 4 });
    expect((await verifyChain()).firstInvalid).toMatchObject({ seq: 4, reason: 'sequence_gap' });
  });

  it('detects a fully rewritten chain through signed checkpoints', async () => {
    const admin = await makeUser('admin');
    await seedChain(3);
    const cp = await api().post('/api/audit/checkpoints').set(auth(admin.token));
    expect(cp.status).toBe(201);
    const checkpointSeq = cp.body.checkpoint.seq as number;

    // Attacker rewrites the entire chain consistently from seq 1.
    const entries = await AuditLog.find().sort({ seq: 1 }).lean();
    let prev = GENESIS_HASH;
    for (const e of entries) {
      const rewritten = { ...e, payload: { rewritten: true }, prevHash: prev };
      const hash = computeHash(rewritten);
      await raw().updateOne({ seq: e.seq }, { $set: { payload: rewritten.payload, prevHash: prev, hash } });
      prev = hash;
    }
    const result = await verifyChain();
    expect(result.ok).toBe(false);
    expect(result.firstInvalid?.reason).toBe('checkpoint_mismatch');
    expect(result.firstInvalid?.seq).toBeLessThanOrEqual(checkpointSeq);
  });

  it('refuses updates through the application layer', async () => {
    await seedChain(1);
    await expect(AuditLog.updateOne({ seq: 1 }, { action: 'x' })).rejects.toThrow(/append-only/);
    await expect(AuditLog.deleteOne({ seq: 1 })).rejects.toThrow(/append-only/);
  });

  it('records real mutations and exposes verification over the API', async () => {
    const admin = await makeUser('admin');
    const reporter = await makeUser('reporter');
    const inc = await createIncident(reporter.token);
    await api().post(`/api/incidents/${inc.id}/comments`).set(auth(admin.token)).send({ body: 'Looking into it' });
    await flushAudit();

    const log = await api().get(`/api/audit?entityId=${inc.id}`).set(auth(admin.token));
    expect(log.body.items.map((e: { action: string }) => e.action)).toEqual(['comment.created', 'incident.created']);

    const ok = await api().get('/api/audit/verify').set(auth(admin.token));
    expect(ok.body.ok).toBe(true);

    const target = await AuditLog.findOne({ action: 'incident.created' }).lean();
    await raw().updateOne({ seq: target!.seq }, { $set: { 'payload.priority': 4 } });
    const bad = await api().get('/api/audit/verify').set(auth(admin.token));
    expect(bad.body).toMatchObject({ ok: false, firstInvalid: { seq: target!.seq, reason: 'hash_mismatch' } });

    const refused = await api().post('/api/audit/checkpoints').set(auth(admin.token));
    expect(refused.status).toBe(409);
  });
});
