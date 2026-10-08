import { createHash, createHmac } from 'node:crypto';

/**
 * Deterministic JSON: object keys sorted recursively, `undefined` dropped, Dates as
 * ISO strings, ObjectIds/other objects with `toHexString` or `toJSON` normalised.
 * The same logical value always produces the same string, which is what the audit
 * hash chain needs.
 */
export function toCanonicalValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : toCanonicalValue(v)));
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown> & { toHexString?: () => string; _bsontype?: string };
    if (typeof obj.toHexString === 'function') return obj.toHexString();
    if (obj._bsontype === 'Decimal128' || obj._bsontype === 'Long') return String(obj);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const v = obj[key];
      if (v === undefined || typeof v === 'function') continue;
      out[key] = toCanonicalValue(v);
    }
    return out;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(toCanonicalValue(value));
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function hmacSha256(key: string, input: string): string {
  return createHmac('sha256', key).update(input, 'utf8').digest('hex');
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
