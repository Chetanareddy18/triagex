import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Fingerprint, ShieldAlert, ShieldCheck, Stamp } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge, Button, Card, EmptyState, ErrorState, Input, LoadingBlock, PageHeader } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { ago, dateTime } from '../../lib/format';
import type { AuditEntry, VerifyResult } from '../../lib/types';

const REASON: Record<string, string> = {
  hash_mismatch: 'Entry contents do not match its stored hash - the entry was edited.',
  broken_link: 'Entry does not point to the previous entry’s hash - a predecessor was rewritten.',
  sequence_gap: 'A sequence number is missing - entries were deleted.',
  checkpoint_mismatch: 'Entry disagrees with a signed checkpoint - the chain was rewritten.',
};

const short = (h: string) => `${h.slice(0, 10)}...${h.slice(-6)}`;

export default function AuditAdmin() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);

  const log = useQuery({
    queryKey: ['audit', page, action],
    queryFn: () => api<{ items: AuditEntry[]; total: number; head: { seq: number; hash: string } | null }>('/api/audit', { query: { page, action, limit: 25 } }),
    placeholderData: keepPreviousData,
  });
  const verify = useMutation({
    mutationFn: () => api<VerifyResult>('/api/audit/verify'),
    onSuccess: (r) => {
      setResult(r);
      if (r.ok) toast.success(`Chain intact: ${r.checked} entries verified`);
      else toast.error(`Tampering detected at entry #${r.firstInvalid?.seq}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const checkpoint = useMutation({
    mutationFn: () => api<{ checkpoint: { seq: number } }>('/api/audit/checkpoints', { method: 'POST' }),
    onSuccess: (r) => {
      toast.success(`Signed checkpoint at #${r.checkpoint.seq}`);
      void qc.invalidateQueries({ queryKey: ['audit'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const pages = log.data ? Math.max(1, Math.ceil(log.data.total / 25)) : 1;

  return (
    <div className="fade-in">
      <PageHeader
        title="Audit trail"
        description="Append-only, SHA-256 hash-chained record of every change. Verification recomputes every hash and stops at the first inconsistency."
        actions={
          <>
            <Button variant="outline" icon={<Stamp className="h-4 w-4" />} loading={checkpoint.isPending} onClick={() => checkpoint.mutate()}>
              Sign checkpoint
            </Button>
            <Button icon={<ShieldCheck className="h-4 w-4" />} loading={verify.isPending} onClick={() => verify.mutate()}>
              Verify integrity
            </Button>
          </>
        }
      />

      {result && (
        <div
          className={clsx(
            'fade-in mb-6 rounded-xl border p-5',
            result.ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/40 bg-red-500/5',
          )}
        >
          <div className="flex items-start gap-3">
            {result.ok ? <ShieldCheck className="h-6 w-6 shrink-0 text-emerald-500" /> : <ShieldAlert className="pulse-ring h-6 w-6 shrink-0 rounded-full text-red-500" />}
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{result.ok ? 'Chain verified - no tampering detected' : `Integrity check failed at entry #${result.firstInvalid?.seq}`}</p>
              <p className="mt-1 text-sm text-muted">
                {result.ok
                  ? `${result.checked} entries and ${result.checkpointsChecked} signed checkpoint(s) checked in ${result.durationMs} ms.`
                  : `${REASON[result.firstInvalid?.reason ?? ''] ?? result.firstInvalid?.reason} ${result.checked} entries before it are intact.`}
              </p>
              <div className="mt-3 grid gap-2 font-mono text-xs sm:grid-cols-2">
                {result.ok ? (
                  <p className="truncate">
                    <span className="text-faint">head #{result.headSeq} </span>
                    {result.headHash}
                  </p>
                ) : (
                  <>
                    <p className="truncate">
                      <span className="text-faint">expected </span>
                      {result.firstInvalid?.expected}
                    </p>
                    <p className="truncate text-red-600 dark:text-red-400">
                      <span className="text-faint">found </span>
                      {result.firstInvalid?.actual}
                    </p>
                  </>
                )}
              </div>
              {!result.ok && result.firstInvalid?.entry && (
                <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-surface p-3 text-xs">{JSON.stringify(result.firstInvalid.entry, null, 2)}</pre>
              )}
            </div>
          </div>
        </div>
      )}

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <Input
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
            placeholder="Filter by action prefix, e.g. incident. or sla."
            className="max-w-xs"
            aria-label="Filter by action"
          />
          {log.data?.head && (
            <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-xs text-muted" title={log.data.head.hash}>
              <Fingerprint className="h-3.5 w-3.5" /> head #{log.data.head.seq} {short(log.data.head.hash)}
            </span>
          )}
        </div>
        {log.error ? (
          <ErrorState error={log.error} retry={log.refetch} />
        ) : log.isLoading ? (
          <div className="p-4">
            <LoadingBlock rows={10} />
          </div>
        ) : !log.data?.items.length ? (
          <EmptyState title="No audit entries" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs tracking-wide text-faint uppercase">
                    <th className="px-4 py-2.5 font-medium">#</th>
                    <th className="px-3 py-2.5 font-medium">Action</th>
                    <th className="px-3 py-2.5 font-medium">Actor</th>
                    <th className="px-3 py-2.5 font-medium">Entity</th>
                    <th className="px-3 py-2.5 font-medium">Hash</th>
                    <th className="px-4 py-2.5 text-right font-medium">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {log.data.items.map((e) => {
                    const bad = result && !result.ok && result.firstInvalid?.seq === e.seq;
                    return (
                      <Fragment key={e.seq}>
                        <tr className={clsx('cursor-pointer transition hover:bg-surface-2/60', bad && 'bg-red-500/10')} onClick={() => setExpanded(expanded === e.seq ? null : e.seq)}>
                          <td className="px-4 py-2.5 font-mono text-xs text-faint">{e.seq}</td>
                          <td className="px-3 py-2.5">
                            <Badge tone={e.action.startsWith('sla') ? 'red' : e.action.startsWith('auth') || e.action.startsWith('user') ? 'blue' : 'neutral'}>{e.action}</Badge>
                          </td>
                          <td className="px-3 py-2.5 text-muted">{e.actorName || e.actor}</td>
                          <td className="px-3 py-2.5 text-xs">
                            {e.entityType === 'incident' ? (
                              <Link to={`/app/incidents/${e.entityId}`} className="text-brand-600 hover:underline dark:text-brand-400" onClick={(ev) => ev.stopPropagation()}>
                                {(e.payload.number as string) ?? e.entityId}
                              </Link>
                            ) : (
                              <span className="text-muted">
                                {e.entityType} {String(e.payload.email ?? '')}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-xs text-muted" title={e.hash}>
                            {short(e.hash)}
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs text-muted" title={dateTime(e.createdAt)}>
                            {ago(e.createdAt)}
                          </td>
                        </tr>
                        {expanded === e.seq && (
                          <tr className="bg-surface-2/40">
                            <td colSpan={6} className="px-4 py-3">
                              <div className="grid gap-3 font-mono text-xs md:grid-cols-2">
                                <div>
                                  <p className="text-faint">prevHash</p>
                                  <p className="break-all">{e.prevHash}</p>
                                  <p className="mt-2 text-faint">hash = sha256(prevHash + canonical(entry))</p>
                                  <p className="break-all">{e.hash}</p>
                                </div>
                                <pre className="max-h-48 overflow-auto rounded-lg bg-surface p-3">{JSON.stringify(e.payload, null, 2)}</pre>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-muted">
              <span>
                {log.data.total} entries - page {page} of {pages}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" icon={<ChevronLeft className="h-4 w-4" />} disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Newer
                </Button>
                <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                  Older <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
