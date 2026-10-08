import { describe, expect, it } from 'vitest';
import { BinaryHeap } from '../../src/lib/heap.js';
import { byLoad, byUrgency, planAssignments, type AgentLoad } from '../../src/services/assignment.js';

const minHeap = () => new BinaryHeap<number>((a, b) => a - b);

describe('BinaryHeap', () => {
  it('pops in ascending order for a min-heap', () => {
    const h = minHeap();
    [5, 3, 9, 1, 7, 1, 0].forEach((n) => h.push(n));
    expect(h.size).toBe(7);
    expect(h.peek()).toBe(0);
    expect(h.drain()).toEqual([0, 1, 1, 3, 5, 7, 9]);
    expect(h.isEmpty()).toBe(true);
  });

  it('returns undefined when empty', () => {
    const h = minHeap();
    expect(h.pop()).toBeUndefined();
    expect(h.peek()).toBeUndefined();
  });

  it('supports max-heaps through the comparator', () => {
    const h = BinaryHeap.from([2, 8, 4, 6], (a, b) => b - a);
    expect(h.drain()).toEqual([8, 6, 4, 2]);
  });

  it('heapify (from) matches sorting for random input', () => {
    for (let trial = 0; trial < 50; trial++) {
      const values = Array.from({ length: 1 + Math.floor(Math.random() * 200) }, () => Math.floor(Math.random() * 1000));
      expect(BinaryHeap.from(values, (a, b) => a - b).drain()).toEqual([...values].sort((a, b) => a - b));
    }
  });

  it('interleaved push/pop keeps the heap invariant', () => {
    const h = minHeap();
    const reference: number[] = [];
    for (let i = 0; i < 2000; i++) {
      if (Math.random() < 0.6 || reference.length === 0) {
        const v = Math.floor(Math.random() * 500);
        h.push(v);
        reference.push(v);
      } else {
        reference.sort((a, b) => a - b);
        expect(h.pop()).toBe(reference.shift());
      }
      expect(h.size).toBe(reference.length);
    }
  });

  it('orders objects with multi-key comparators', () => {
    const h = BinaryHeap.from(
      [
        { id: 'a', priority: 3 as const, dueAt: 10 },
        { id: 'b', priority: 1 as const, dueAt: 50 },
        { id: 'c', priority: 1 as const, dueAt: 20 },
        { id: 'd', priority: 2 as const, dueAt: 5 },
      ],
      byUrgency,
    );
    expect(h.drain().map((x) => x.id)).toEqual(['c', 'b', 'd', 'a']);
  });
});

describe('planAssignments (weighted least-load)', () => {
  const agent = (id: string, load = 0, open = 0, lastAssignedAt = 0): AgentLoad => ({ id, name: id, load, open, lastAssignedAt });

  it('gives the most urgent incident to the least-loaded agent', () => {
    const plan = planAssignments(
      [
        { id: 'p4', priority: 4, dueAt: 1 },
        { id: 'p1', priority: 1, dueAt: 9 },
      ],
      [agent('busy', 10), agent('idle', 0)],
    );
    expect(plan[0]).toMatchObject({ incidentId: 'p1', agentId: 'idle' });
  });

  it('accounts for priority weight when balancing', () => {
    // idle gets the P1 (weight 8); the next three P3s (weight 2) should go to the other agent
    // until its load catches up.
    const plan = planAssignments(
      [
        { id: 'p1', priority: 1, dueAt: 0 },
        { id: 'a', priority: 3, dueAt: 1 },
        { id: 'b', priority: 3, dueAt: 2 },
        { id: 'c', priority: 3, dueAt: 3 },
      ],
      [agent('x', 0), agent('y', 1)],
    );
    expect(plan.map((p) => `${p.incidentId}:${p.agentId}`)).toEqual(['p1:x', 'a:y', 'b:y', 'c:y']);
  });

  it('breaks ties by open count then least-recently assigned', () => {
    expect([agent('a', 4, 3), agent('b', 4, 1)].sort(byLoad)[0].id).toBe('b');
    expect([agent('a', 4, 1, 200), agent('b', 4, 1, 100)].sort(byLoad)[0].id).toBe('b');
  });

  it('returns an empty plan without agents and does not mutate inputs', () => {
    expect(planAssignments([{ id: 'x', priority: 1, dueAt: 0 }], [])).toEqual([]);
    const agents = [agent('a', 0)];
    planAssignments([{ id: 'x', priority: 1, dueAt: 0 }], agents);
    expect(agents[0].load).toBe(0);
  });

  it('spreads equal work evenly', () => {
    const queue = Array.from({ length: 9 }, (_, i) => ({ id: `i${i}`, priority: 3 as const, dueAt: i }));
    const plan = planAssignments(queue, [agent('a'), agent('b'), agent('c')]);
    const counts = plan.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.agentId]: (acc[p.agentId] ?? 0) + 1 }), {});
    expect(counts).toEqual({ a: 3, b: 3, c: 3 });
  });
});
