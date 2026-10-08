import { env } from '../config/env.js';
import { canonicalJson, hmacSha256, sha256, toCanonicalValue } from '../lib/canonical.js';
import { logger } from '../lib/logger.js';
import { AuditCheckpoint, AuditLog, type IAuditLog } from '../models/AuditLog.js';

export const GENESIS_HASH = '0'.repeat(64);

export interface Actor {
  id: string;
  name: string;
}
export const SYSTEM_ACTOR: Actor = { id: 'system', name: 'TriageX automation' };

type HashableEntry = Omit<IAuditLog, 'hash'>;

/** hash = SHA-256(prevHash + canonicalJSON(entry without hash)). */
export function computeHash(entry: HashableEntry): string {
  const { prevHash, ...body } = entry;
  return sha256(
    prevHash +
      canonicalJson({
        seq: body.seq,
        action: body.action,
        actor: body.actor,
        actorName: body.actorName,
        entityType: body.entityType,
        entityId: body.entityId,
        payload: body.payload,
        createdAt: body.createdAt,
      }),
  );
}

// Appends are serialised in-process; the unique index on `seq` plus the retry loop
// keeps the chain linear even if several API instances write concurrently.
let tail: Promise<unknown> = Promise.resolve();

export function recordAudit(
  action: string,
  actor: Actor,
  entity: { type: string; id: string },
  payload: Record<string, unknown> = {},
): Promise<IAuditLog> {
  const run = async (): Promise<IAuditLog> => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const last = await AuditLog.findOne({}, { seq: 1, hash: 1 }).sort({ seq: -1 }).lean();
      const entry: HashableEntry = {
        seq: (last?.seq ?? 0) + 1,
        action,
        actor: actor.id,
        actorName: actor.name,
        entityType: entity.type,
        entityId: entity.id,
        payload: toCanonicalValue(payload) as Record<string, unknown>,
        createdAt: new Date().toISOString(),
        prevHash: last?.hash ?? GENESIS_HASH,
      };
      const full: IAuditLog = { ...entry, hash: computeHash(entry) };
      try {
        await AuditLog.create(full);
        return full;
      } catch (err) {
        if ((err as { code?: number }).code === 11000) continue; // another writer took this seq
        throw err;
      }
    }
    throw new Error('could not append audit entry after 5 attempts');
  };
  const result = tail.then(run, run);
  tail = result.catch((err) => logger.error({ err }, 'audit append failed'));
  return result;
}

export type VerifyFailureReason = 'hash_mismatch' | 'broken_link' | 'sequence_gap' | 'checkpoint_mismatch';

export interface VerifyResult {
  ok: boolean;
  checked: number;
  headSeq: number;
  headHash: string;
  checkpointsChecked: number;
  firstInvalid?: {
    seq: number;
    reason: VerifyFailureReason;
    expected: string;
    actual: string;
    entry?: Partial<IAuditLog>;
  };
  durationMs: number;
}

/** Walks the chain in order and reports the first entry that fails verification. */
export async function verifyChain(): Promise<VerifyResult> {
  const started = Date.now();
  const checkpoints = new Map<number, { hash: string; signature: string }>();
  for (const cp of await AuditCheckpoint.find().lean()) checkpoints.set(cp.seq, cp);

  let prevHash = GENESIS_HASH;
  let expectedSeq = 1;
  let checked = 0;
  let checkpointsChecked = 0;

  const fail = (seq: number, reason: VerifyFailureReason, expected: string, actual: string, entry?: Partial<IAuditLog>): VerifyResult => ({
    ok: false,
    checked,
    headSeq: seq,
    headHash: prevHash,
    checkpointsChecked,
    firstInvalid: { seq, reason, expected, actual, entry },
    durationMs: Date.now() - started,
  });

  const cursor = AuditLog.find({}, { _id: 0 }).sort({ seq: 1 }).lean().cursor();
  for await (const raw of cursor) {
    const entry = raw as unknown as IAuditLog;
    if (entry.seq !== expectedSeq) {
      return fail(expectedSeq, 'sequence_gap', `seq ${expectedSeq}`, `seq ${entry.seq}`, entry);
    }
    if (entry.prevHash !== prevHash) {
      return fail(entry.seq, 'broken_link', prevHash, entry.prevHash, entry);
    }
    const recomputed = computeHash(entry);
    if (recomputed !== entry.hash) {
      return fail(entry.seq, 'hash_mismatch', recomputed, entry.hash, entry);
    }
    const cp = checkpoints.get(entry.seq);
    if (cp) {
      checkpointsChecked++;
      const sig = signCheckpoint(entry.seq, entry.hash);
      if (cp.hash !== entry.hash || cp.signature !== sig) {
        return fail(entry.seq, 'checkpoint_mismatch', cp.hash, entry.hash, entry);
      }
    }
    prevHash = entry.hash;
    expectedSeq++;
    checked++;
  }

  // A checkpoint beyond the current head means entries were truncated from the end.
  const beyond = [...checkpoints.keys()].filter((seq) => seq >= expectedSeq).sort((a, b) => a - b)[0];
  if (beyond !== undefined) {
    return fail(expectedSeq, 'sequence_gap', `entries up to seq ${beyond}`, `chain ends at seq ${expectedSeq - 1}`);
  }

  return { ok: true, checked, headSeq: expectedSeq - 1, headHash: prevHash, checkpointsChecked, durationMs: Date.now() - started };
}

export function signCheckpoint(seq: number, hash: string): string {
  return hmacSha256(env.AUDIT_SIGNING_KEY, `${seq}:${hash}`);
}

export async function createCheckpoint(createdBy: string) {
  const head = await AuditLog.findOne().sort({ seq: -1 }).lean();
  if (!head) return null;
  return AuditCheckpoint.create({ seq: head.seq, hash: head.hash, signature: signCheckpoint(head.seq, head.hash), createdBy });
}

/** Test/seed helper: wait until queued audit writes are flushed. */
export function flushAudit(): Promise<unknown> {
  return tail;
}
