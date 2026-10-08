import cron, { type ScheduledTask } from 'node-cron';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { Incident } from '../models/Incident.js';
import { autoAssignOne } from '../services/incidents.js';
import { embed, incidentText } from '../services/ml.js';
import { runSlaScan } from '../services/sla.js';

const tasks: ScheduledTask[] = [];

/** Wraps a job so a slow run is never overlapped by the next tick. */
function guarded(name: string, fn: () => Promise<unknown>) {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      await fn();
    } catch (err) {
      logger.error({ err, job: name }, 'job failed');
    } finally {
      running = false;
    }
  };
}

/**
 * Re-embeds incidents that have no embedding (created while the ML service was
 * down, or seeded) or whose embedding came from a different model.
 */
export async function backfillEmbeddings(batch = 64): Promise<number> {
  const probe = await embed(['probe']);
  if (!probe) return 0;
  const stale = await Incident.find({ $or: [{ embedding: null }, { 'embedding.model': { $ne: probe.model } }] })
    .select('title description')
    .limit(batch)
    .lean();
  if (stale.length === 0) return 0;
  const result = await embed(stale.map(incidentText));
  if (!result) return 0;
  await Incident.bulkWrite(
    stale.map((inc, i) => ({
      updateOne: { filter: { _id: inc._id }, update: { $set: { embedding: { model: result.model, vector: result.vectors[i] } } } },
    })),
  );
  logger.info({ count: stale.length, model: result.model }, 'backfilled embeddings');
  return stale.length;
}

export function startScheduler() {
  if (!env.ENABLE_SCHEDULER) {
    logger.info('scheduler disabled');
    return;
  }
  tasks.push(
    cron.schedule(env.SLA_SCAN_CRON, guarded('sla-scan', () => runSlaScan(new Date(), (id) => autoAssignOne(id)))),
    cron.schedule('*/2 * * * *', guarded('embedding-backfill', () => backfillEmbeddings())),
  );
  logger.info({ slaCron: env.SLA_SCAN_CRON }, 'scheduler started');
}

export function stopScheduler() {
  for (const t of tasks.splice(0)) void t.stop();
}
