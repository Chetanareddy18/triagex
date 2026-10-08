import type { Types } from 'mongoose';
import { OPEN_STATUSES, PRIORITY_WEIGHT, type Priority } from '../lib/domain.js';
import { BinaryHeap } from '../lib/heap.js';
import { Incident } from '../models/Incident.js';
import { User } from '../models/User.js';

export interface AgentLoad {
  id: string;
  name: string;
  load: number; // sum of PRIORITY_WEIGHT over open assigned incidents
  open: number;
  lastAssignedAt: number; // epoch ms, for round-robin tie-breaking
}

export interface QueueItem {
  id: string;
  priority: Priority;
  dueAt: number;
}

/** Least weighted load first; ties -> fewer tickets -> least recently assigned -> name. */
export const byLoad = (a: AgentLoad, b: AgentLoad) =>
  a.load - b.load || a.open - b.open || a.lastAssignedAt - b.lastAssignedAt || a.name.localeCompare(b.name);

/** Most urgent first: lower priority number, then earliest SLA due time. */
export const byUrgency = (a: QueueItem, b: QueueItem) => a.priority - b.priority || a.dueAt - b.dueAt;

/**
 * Greedy weighted assignment: repeatedly give the most urgent unassigned incident to
 * the currently least-loaded agent, then push the agent back with its new load.
 * O((n + m) log m) for n incidents and m agents.
 */
export function planAssignments(queue: QueueItem[], agents: AgentLoad[], now = Date.now()) {
  const plan: { incidentId: string; agentId: string; agentName: string; loadBefore: number }[] = [];
  if (agents.length === 0) return plan;
  const incidents = BinaryHeap.from(queue, byUrgency);
  const pool = BinaryHeap.from(
    agents.map((a) => ({ ...a })),
    byLoad,
  );
  let tick = 0;
  while (!incidents.isEmpty()) {
    const item = incidents.pop() as QueueItem;
    const agent = pool.pop() as AgentLoad;
    plan.push({ incidentId: item.id, agentId: agent.id, agentName: agent.name, loadBefore: agent.load });
    agent.load += PRIORITY_WEIGHT[item.priority];
    agent.open += 1;
    agent.lastAssignedAt = now + ++tick;
    pool.push(agent);
  }
  return plan;
}

export async function currentAgentLoads(): Promise<AgentLoad[]> {
  const agents = await User.find({ role: 'agent', active: true }, { name: 1 }).lean();
  if (agents.length === 0) return [];
  const rows = await Incident.aggregate<{ _id: Types.ObjectId; load: number; open: number; last: Date }>([
    { $match: { status: { $in: OPEN_STATUSES }, assignee: { $in: agents.map((a) => a._id) } } },
    {
      $group: {
        _id: '$assignee',
        open: { $sum: 1 },
        last: { $max: '$updatedAt' },
        load: {
          $sum: {
            $switch: {
              branches: ([1, 2, 3] as const).map((p) => ({ case: { $eq: ['$priority', p] }, then: PRIORITY_WEIGHT[p] })),
              default: PRIORITY_WEIGHT[4],
            },
          },
        },
      },
    },
  ]);
  const byId = new Map(rows.map((r) => [String(r._id), r]));
  return agents.map((a) => {
    const r = byId.get(String(a._id));
    return { id: String(a._id), name: a.name, load: r?.load ?? 0, open: r?.open ?? 0, lastAssignedAt: r?.last?.getTime() ?? 0 };
  });
}

/** Picks the single best agent for one incident (least weighted load). */
export async function pickAgent(): Promise<AgentLoad | null> {
  const loads = await currentAgentLoads();
  if (loads.length === 0) return null;
  return BinaryHeap.from(loads, byLoad).peek() ?? null;
}
