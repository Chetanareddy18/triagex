import clsx from 'clsx';
import { PRIORITY_LABEL, SLA_LABEL, STATUS_LABEL } from '../lib/format';
import type { Priority, SlaState, Status } from '../lib/types';
import { Badge } from './ui';

const PRIORITY_TONE = { 1: 'red', 2: 'orange', 3: 'amber', 4: 'slate' } as const;
const STATUS_TONE = { new: 'blue', assigned: 'brand', in_progress: 'amber', resolved: 'green', closed: 'neutral' } as const;
const SLA_TONE = { on_track: 'green', at_risk: 'amber', breached: 'red', met: 'neutral' } as const;

export function PriorityBadge({ priority, compact }: { priority: Priority; compact?: boolean }) {
  return (
    <Badge tone={PRIORITY_TONE[priority]} className="font-semibold">
      P{priority}
      {!compact && <span className="font-medium opacity-80">{PRIORITY_LABEL[priority]}</span>}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function SlaBadge({ state }: { state: SlaState }) {
  return (
    <Badge tone={SLA_TONE[state]} className={clsx(state === 'breached' && 'font-semibold')}>
      {SLA_LABEL[state]}
    </Badge>
  );
}

/** Thin bar showing how much of the SLA resolution window has elapsed. */
export function SlaBar({ progress, state }: { progress: number; state: SlaState }) {
  const width = Math.min(100, Math.max(2, progress));
  const color =
    state === 'met' ? 'bg-slate-400' : state === 'breached' || progress >= 100 ? 'bg-red-500' : progress >= 75 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2" title={`${progress}% of the resolution window used`}>
      <div className={clsx('h-full rounded-full transition-all', color)} style={{ width: `${width}%` }} />
    </div>
  );
}

/** Model confidence as a labelled bar (0..1). */
export function ConfidenceBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.round(value * 100);
  const color = pct >= 70 ? 'bg-emerald-500' : pct >= 45 ? 'bg-amber-500' : 'bg-slate-400';
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] text-muted">
        <span>{label ?? 'Confidence'}</span>
        <span className="tabular-nums font-medium text-ink">{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div className={clsx('h-full rounded-full', color)} style={{ width: `${Math.max(3, pct)}%` }} />
      </div>
    </div>
  );
}
