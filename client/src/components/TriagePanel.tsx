import { BrainCircuit, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { CATEGORY_LABEL, hours, pct } from '../lib/format';
import type { AiTriage, SimilarIncident } from '../lib/types';
import { ConfidenceBar, PriorityBadge, StatusBadge } from './badges';
import { Badge } from './ui';

interface Signals {
  itil?: { priority: number };
  neighbors?: { support: number; distribution: number[] };
  lexicon?: { matches: string[] };
  fallback?: { itil: number; keyword: number | null };
  prior?: unknown;
}

export function TriagePanel({ ai, compact }: { ai: AiTriage; compact?: boolean }) {
  const s = (ai.signals ?? {}) as Signals;
  const reasons: string[] = [];
  if (s.itil) reasons.push(`ITIL impact x urgency matrix gives P${s.itil.priority}`);
  if (s.neighbors) reasons.push(`similar past incidents vote (evidence ${s.neighbors.support.toFixed(1)})`);
  if (s.lexicon?.matches?.length) reasons.push(`keywords: ${s.lexicon.matches.slice(0, 4).map((m) => `"${m}"`).join(', ')}`);
  if (s.fallback) reasons.push('rule-based fallback (ML service unavailable)');
  if (s.prior) reasons.push('not enough information - showing the base rate');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <PriorityBadge priority={ai.priority} />
        <Badge tone="brand">{CATEGORY_LABEL[ai.category]}</Badge>
        <Badge tone={ai.source === 'ml' ? 'green' : 'slate'} className="ml-auto">
          {ai.source === 'ml' ? 'ML model' : 'Fallback rules'}
        </Badge>
      </div>
      <ConfidenceBar value={ai.priorityConfidence} label="Priority confidence" />
      {ai.categoryConfidence > 0 && <ConfidenceBar value={ai.categoryConfidence} label="Category confidence" />}
      {ai.breachRisk != null && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-surface-2 p-3">
            <p className="text-[11px] text-muted">SLA breach risk</p>
            <p className="text-lg font-semibold tabular-nums">{pct(ai.breachRisk)}</p>
          </div>
          <div className="rounded-lg bg-surface-2 p-3">
            <p className="text-[11px] text-muted">Typical resolution</p>
            <p className="text-lg font-semibold tabular-nums">{hours(ai.expectedResolutionHours)}</p>
          </div>
        </div>
      )}
      {!compact && ai.priorityDistribution?.length === 4 && (
        <div>
          <p className="mb-1.5 text-[11px] text-muted">Priority distribution</p>
          <div className="flex h-2 overflow-hidden rounded-full bg-surface-2">
            {ai.priorityDistribution.map((p, i) => (
              <div
                key={i}
                title={`P${i + 1}: ${pct(p)}`}
                style={{ width: `${p * 100}%` }}
                className={['bg-red-500', 'bg-orange-500', 'bg-amber-400', 'bg-slate-400'][i] + ' border-r-2 border-surface last:border-0'}
              />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-faint">
            {ai.priorityDistribution.map((p, i) => (
              <span key={i}>
                P{i + 1} {pct(p)}
              </span>
            ))}
          </div>
        </div>
      )}
      {reasons.length > 0 && (
        <div className="flex gap-2 rounded-lg border border-line p-3 text-xs text-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
          <p>
            <span className="font-medium text-ink">Why: </span>
            {reasons.join('; ')}.
          </p>
        </div>
      )}
      {ai.breachRisk != null && !compact && (
        <p className="text-[11px] leading-relaxed text-faint">
          Breach risk and resolution time come from a model trained on the public UCI incident log; treat them as a relative signal, not a guarantee. See the model card.
        </p>
      )}
    </div>
  );
}

export function SimilarList({ items, method }: { items: SimilarIncident[]; method?: string }) {
  if (!items.length) return <p className="text-sm text-muted">No similar incidents found yet.</p>;
  return (
    <div>
      <ul className="space-y-2">
        {items.map((s) => (
          <li key={s.id}>
            <Link to={`/app/incidents/${s.id}`} className="block rounded-lg border border-line p-3 transition hover:border-brand-500/40 hover:bg-surface-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-faint">{s.number}</span>
                <StatusBadge status={s.status} />
                <span className="ml-auto text-[11px] font-medium text-brand-600 tabular-nums dark:text-brand-400" title="Cosine similarity">
                  {Math.round(s.similarity * 100)}% match
                </span>
              </div>
              <p className="mt-1 line-clamp-1 text-sm font-medium">{s.title}</p>
              {s.resolutionSummary && <p className="mt-1 line-clamp-2 text-xs text-muted">Fix: {s.resolutionSummary}</p>}
            </Link>
          </li>
        ))}
      </ul>
      {method && (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-faint">
          <BrainCircuit className="h-3 w-3" />
          {method === 'embedding' ? 'Semantic search over sentence embeddings' : 'Keyword relevance (embeddings unavailable)'}
        </p>
      )}
    </div>
  );
}
