import { env } from '../config/env.js';
import { cosineSimilarity } from '../lib/canonical.js';
import { CATEGORIES, itilPriority, type Category, type Channel, type Priority } from '../lib/domain.js';
import { logger } from '../lib/logger.js';
import { Incident, type AiTriage } from '../models/Incident.js';

export interface TriageFields {
  title: string;
  description?: string;
  channel?: Channel;
  impact?: number;
  urgency?: number;
  openedAt?: Date;
}

export interface SimilarIncident {
  id: string;
  number: string;
  title: string;
  status: string;
  priority: Priority;
  category: Category;
  similarity: number;
  resolutionSummary?: string;
}

let mlHealthy: boolean | null = null;
export const mlStatus = () => mlHealthy;

async function call<T>(path: string, body?: unknown, timeoutMs = env.ML_TIMEOUT_MS): Promise<T> {
  const res = await fetch(`${env.ML_URL}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(env.ML_API_KEY ? { 'x-ml-key': env.ML_API_KEY } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`ml ${path} -> HTTP ${res.status}`);
  mlHealthy = true;
  return (await res.json()) as T;
}

function markDown(err: unknown, what: string) {
  if (mlHealthy !== false) logger.warn({ err: (err as Error).message }, `ml service unavailable (${what}); using fallback`);
  mlHealthy = false;
}

export async function mlHealth() {
  try {
    return await call<{ status: string; embedding: { model: string; dim: number }; modelVersion: string }>('/health', undefined, 1500);
  } catch (err) {
    markDown(err, 'health');
    return null;
  }
}

export async function mlMetrics(): Promise<unknown | null> {
  try {
    return await call('/metrics', undefined, 3000);
  } catch (err) {
    markDown(err, 'metrics');
    return null;
  }
}

export const incidentText = (t: { title: string; description?: string }) => `${t.title}\n${t.description ?? ''}`.trim();

export async function embed(texts: string[]): Promise<{ model: string; vectors: number[][] } | null> {
  try {
    return await call<{ model: string; vectors: number[][] }>('/embed', { texts });
  } catch (err) {
    markDown(err, 'embed');
    return null;
  }
}

/**
 * Nearest past incidents by cosine similarity over stored embeddings. Falls back to
 * MongoDB full-text relevance when no embedding is available.
 */
export async function findSimilar(
  query: { text: string; embedding?: { model: string; vector: number[] } | null },
  opts: { excludeId?: string; limit?: number; minSimilarity?: number } = {},
): Promise<{ method: 'embedding' | 'text'; items: SimilarIncident[] }> {
  const limit = opts.limit ?? 5;
  const minSimilarity = opts.minSimilarity ?? 0.25;
  if (query.embedding?.vector?.length) {
    const candidates = await Incident.find({
      'embedding.model': query.embedding.model,
      ...(opts.excludeId ? { _id: { $ne: opts.excludeId } } : {}),
    })
      .select('+embedding number title status priority category resolution.summary')
      .sort({ createdAt: -1 })
      .limit(5000)
      .lean();
    const scored = candidates
      .map((c) => ({ c, s: cosineSimilarity(query.embedding!.vector, c.embedding?.vector ?? []) }))
      .filter((x) => x.s >= minSimilarity)
      .sort((a, b) => b.s - a.s)
      .slice(0, limit);
    return {
      method: 'embedding',
      items: scored.map(({ c, s }) => ({
        id: String(c._id),
        number: c.number,
        title: c.title,
        status: c.status,
        priority: c.priority,
        category: c.category,
        similarity: Math.round(s * 1000) / 1000,
        resolutionSummary: c.resolution?.summary,
      })),
    };
  }

  const words = query.text.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  if (!words) return { method: 'text', items: [] };
  const rows = await Incident.find(
    { $text: { $search: words }, ...(opts.excludeId ? { _id: { $ne: opts.excludeId } } : {}) },
    { score: { $meta: 'textScore' }, number: 1, title: 1, status: 1, priority: 1, category: 1, 'resolution.summary': 1 },
  )
    .sort({ score: { $meta: 'textScore' } })
    .limit(limit)
    .lean<Array<Record<string, unknown> & { score: number }>>();
  const top = rows[0]?.score ?? 1;
  return {
    method: 'text',
    items: rows.map((r) => ({
      id: String(r._id),
      number: r.number as string,
      title: r.title as string,
      status: r.status as string,
      priority: r.priority as Priority,
      category: r.category as Category,
      similarity: Math.round((r.score / top) * 0.8 * 1000) / 1000, // relative relevance, capped below 1
      resolutionSummary: (r.resolution as { summary?: string } | undefined)?.summary,
    })),
  };
}

// --------------------------------------------------------------------------- fallback
const FALLBACK_SEVERITY: [RegExp, Priority][] = [
  [/\b(outage|down for everyone|all users|production down|data loss|ransomware|breach|payments? failing|site down)\b/i, 1],
  [/\b(degraded|slow|intermittent|multiple users|timeouts?|cannot log ?in|locked out|vpn)\b/i, 2],
  [/\b(cosmetic|typo|request|question|how do i|minor|suggestion)\b/i, 4],
];
const FALLBACK_CATEGORY: [RegExp, Category][] = [
  [/\b(phishing|malware|ransomware|breach|suspicious|virus|vulnerability)\b/i, 'security'],
  [/\b(vpn|wi-?fi|network|dns|latency|router|firewall|proxy)\b/i, 'network'],
  [/\b(password|login|log in|sso|permission|access|mfa|locked out)\b/i, 'access'],
  [/\b(database|postgres|mysql|mongo|replication|deadlock|query|backup)\b/i, 'database'],
  [/\b(email|outlook|mailbox|smtp|inbox|calendar)\b/i, 'email'],
  [/\b(laptop|monitor|keyboard|printer|battery|disk|dock|screen)\b/i, 'hardware'],
  [/\b(crash|bug|install|update|application|deploy|release|error)\b/i, 'software'],
];

/** Rule-based triage used when the ML service is unreachable. */
export function fallbackTriage(fields: TriageFields): Omit<AiTriage, 'applied' | 'at'> {
  const text = incidentText(fields);
  const itil = itilPriority(fields.impact ?? 2, fields.urgency ?? 2);
  const keyword = FALLBACK_SEVERITY.find(([re]) => re.test(text))?.[1];
  const priority = (keyword !== undefined ? Math.round((itil + keyword) / 2) : itil) as Priority;
  const category = FALLBACK_CATEGORY.find(([re]) => re.test(text))?.[1] ?? 'other';
  const dist = [0, 0, 0, 0];
  dist[priority - 1] = 1;
  return {
    priority,
    priorityConfidence: keyword !== undefined && keyword === itil ? 0.6 : 0.4,
    priorityDistribution: dist,
    category,
    categoryConfidence: category === 'other' ? 0 : 0.4,
    breachRisk: null,
    expectedResolutionHours: null,
    signals: { fallback: { itil, keyword: keyword ?? null } },
    source: 'fallback',
    modelVersion: 'rules-v1',
  };
}

export interface TriageOutcome {
  ai: Omit<AiTriage, 'applied' | 'at'>;
  embedding: { model: string; vector: number[] } | null;
  similar: { method: 'embedding' | 'text'; items: SimilarIncident[] };
}

/** Embeds the text, finds neighbours, then asks the ML service to triage. Never throws. */
export async function triageIncident(fields: TriageFields, opts: { excludeId?: string } = {}): Promise<TriageOutcome> {
  const text = incidentText(fields);
  const embedded = await embed([text]);
  const embedding = embedded ? { model: embedded.model, vector: embedded.vectors[0] } : null;
  const similar = await findSimilar({ text, embedding }, { excludeId: opts.excludeId, limit: 8 }).catch(() => ({
    method: 'text' as const,
    items: [],
  }));

  // Only incidents an agent has worked on carry trustworthy labels for the vote.
  const labelled = await Incident.find(
    { _id: { $in: similar.items.map((s) => s.id) }, status: { $ne: 'new' } },
    { _id: 1 },
  ).lean();
  const trusted = new Set(labelled.map((l) => String(l._id)));
  const neighbors = similar.items
    .filter((s) => trusted.has(s.id))
    .map((s) => ({ priority: s.priority, category: CATEGORIES.includes(s.category) ? s.category : null, similarity: s.similarity }));

  if (embedded) {
    try {
      const ai = await call<Omit<AiTriage, 'applied' | 'at' | 'source'>>('/triage', {
        title: fields.title,
        description: fields.description ?? '',
        channel: fields.channel,
        impact: fields.impact,
        urgency: fields.urgency,
        openedAt: (fields.openedAt ?? new Date()).toISOString(),
        neighbors,
      });
      return { ai: { ...ai, source: 'ml' }, embedding, similar: { ...similar, items: similar.items.slice(0, 5) } };
    } catch (err) {
      markDown(err, 'triage');
    }
  }
  return { ai: fallbackTriage(fields), embedding, similar: { ...similar, items: similar.items.slice(0, 5) } };
}
