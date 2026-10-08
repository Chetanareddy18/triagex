import { describe, expect, it } from 'vitest';
import { canonicalJson, cosineSimilarity } from '../../src/lib/canonical.js';
import { itilPriority, STATUSES } from '../../src/lib/domain.js';
import { allowedTransitions, canTransition, roleCanTransition, transitionName, TRANSITIONS } from '../../src/lib/stateMachine.js';
import { computeHash, GENESIS_HASH } from '../../src/services/audit.js';
import { computeDueDates, evaluateSla } from '../../src/services/sla.js';
import { fallbackTriage } from '../../src/services/ml.js';

describe('state machine', () => {
  it('allows the happy path', () => {
    expect(canTransition('new', 'assigned')).toBe(true);
    expect(canTransition('assigned', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'resolved')).toBe(true);
    expect(canTransition('resolved', 'closed')).toBe(true);
  });

  it('rejects skipping states and self transitions', () => {
    expect(canTransition('new', 'resolved')).toBe(false);
    expect(canTransition('new', 'closed')).toBe(false);
    expect(canTransition('assigned', 'closed')).toBe(false);
    for (const s of STATUSES) expect(canTransition(s, s)).toBe(false);
  });

  it('names transitions, including reopen', () => {
    expect(transitionName('new', 'assigned')).toBe('assign');
    expect(transitionName('in_progress', 'assigned')).toBe('handback');
    expect(transitionName('resolved', 'assigned')).toBe('reopen');
    expect(transitionName('closed', 'assigned')).toBe('reopen');
    expect(transitionName('assigned', 'new')).toBe('unassign');
    expect(transitionName('new', 'closed')).toBeNull();
  });

  it('every target of the table is a valid status', () => {
    for (const targets of Object.values(TRANSITIONS)) for (const t of targets) expect(STATUSES).toContain(t);
  });

  it('limits reporters to close/reopen on their own tickets', () => {
    expect(roleCanTransition('reporter', 'close', true)).toBe(true);
    expect(roleCanTransition('reporter', 'reopen', true)).toBe(true);
    expect(roleCanTransition('reporter', 'reopen', false)).toBe(false);
    expect(roleCanTransition('reporter', 'start', true)).toBe(false);
    expect(roleCanTransition('agent', 'resolve', false)).toBe(true);
    expect(allowedTransitions('resolved', 'reporter', true)).toEqual(['closed', 'assigned']);
    expect(allowedTransitions('new', 'reporter', true)).toEqual([]);
  });
});

describe('ITIL priority matrix', () => {
  it('matches the UCI dataset mapping', () => {
    expect(itilPriority(1, 1)).toBe(1);
    expect(itilPriority(1, 2)).toBe(2);
    expect(itilPriority(2, 2)).toBe(3);
    expect(itilPriority(2, 3)).toBe(4);
    expect(itilPriority(3, 3)).toBe(4);
  });
});

describe('canonical JSON + hashing', () => {
  it('is independent of key order and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } })).toBe(canonicalJson({ a: { d: [1, { y: 2, z: 1 }] }, b: 1 }));
    expect(canonicalJson({ when: new Date('2026-01-01T00:00:00Z') })).toBe('{"when":"2026-01-01T00:00:00.000Z"}');
  });

  it('chains hashes deterministically', () => {
    const entry = {
      seq: 1,
      action: 'x',
      actor: 'u',
      actorName: 'U',
      entityType: 'incident',
      entityId: 'i',
      payload: { a: 1 },
      createdAt: '2026-01-01T00:00:00.000Z',
      prevHash: GENESIS_HASH,
    };
    const h = computeHash(entry);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(computeHash({ ...entry })).toBe(h);
    expect(computeHash({ ...entry, payload: { a: 2 } })).not.toBe(h);
    expect(computeHash({ ...entry, prevHash: 'f'.repeat(64) })).not.toBe(h);
  });

  it('computes cosine similarity', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
  });
});

describe('SLA evaluation', () => {
  const policies = { 1: { responseMinutes: 15, resolutionMinutes: 240 }, 2: { responseMinutes: 60, resolutionMinutes: 480 }, 3: { responseMinutes: 240, resolutionMinutes: 1440 }, 4: { responseMinutes: 480, resolutionMinutes: 4320 } };
  const opened = new Date('2026-03-02T10:00:00Z');
  const due = computeDueDates(opened, 1, policies);

  it('computes due dates from the policy', () => {
    expect(due.responseDueAt.toISOString()).toBe('2026-03-02T10:15:00.000Z');
    expect(due.resolutionDueAt.toISOString()).toBe('2026-03-02T14:00:00.000Z');
  });

  const inc = (status: 'new' | 'resolved', state: 'on_track' | 'breached' = 'on_track') => ({
    status,
    createdAt: opened,
    sla: { resolutionDueAt: due.resolutionDueAt, state },
  });
  const at = (minutes: number) => new Date(opened.getTime() + minutes * 60_000);

  it('moves on_track -> at_risk at 75% -> breached after due', () => {
    expect(evaluateSla(inc('new'), at(60), 0.75)).toBe('on_track');
    expect(evaluateSla(inc('new'), at(180), 0.75)).toBe('at_risk');
    expect(evaluateSla(inc('new'), at(241), 0.75)).toBe('breached');
  });

  it('never un-breaches and settles closed tickets', () => {
    expect(evaluateSla(inc('new', 'breached'), at(1), 0.75)).toBe('breached');
    expect(evaluateSla(inc('resolved'), at(500), 0.75)).toBe('met');
    expect(evaluateSla(inc('resolved', 'breached'), at(500), 0.75)).toBe('breached');
  });
});

describe('fallback triage', () => {
  it('uses ITIL + keywords when the ML service is down', () => {
    const out = fallbackTriage({ title: 'Production down for all users', impact: 1, urgency: 1 });
    expect(out).toMatchObject({ priority: 1, source: 'fallback' });
    expect(fallbackTriage({ title: 'Outlook calendar not syncing', impact: 2, urgency: 2 })).toMatchObject({ priority: 3, category: 'email' });
  });
});
