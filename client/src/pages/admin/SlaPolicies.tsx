import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PriorityBadge } from '../../components/badges';
import { Button, Card, ErrorState, Input, LoadingBlock, PageHeader } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { minutesLabel } from '../../lib/format';
import type { SlaPolicy } from '../../lib/types';

export default function SlaPolicies() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['sla-policies'], queryFn: () => api<{ policies: SlaPolicy[] }>('/api/sla/policies').then((r) => r.policies) });
  const [draft, setDraft] = useState<SlaPolicy[]>([]);
  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  const save = useMutation({
    mutationFn: () => api<{ policies: SlaPolicy[] }>('/api/sla/policies', { method: 'PUT', body: { policies: draft } }),
    onSuccess: () => {
      toast.success('SLA policies saved', { description: 'Applies to new incidents and priority changes. Recorded in the audit trail.' });
      void qc.invalidateQueries({ queryKey: ['sla-policies'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const scan = useMutation({
    mutationFn: () => api<{ scanned: number; atRisk: number; breached: number; escalated: number }>('/api/sla/scan', { method: 'POST' }),
    onSuccess: (r) => toast.success(`Scanned ${r.scanned} open incidents`, { description: `${r.atRisk} newly at risk, ${r.breached} breached, ${r.escalated} escalated` }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const dirty = JSON.stringify(draft) !== JSON.stringify(data);
  const invalid = draft.some((p) => !(p.responseMinutes > 0 && p.resolutionMinutes > 0 && p.responseMinutes <= p.resolutionMinutes));
  const setField = (priority: number, key: 'responseMinutes' | 'resolutionMinutes', value: number) =>
    setDraft((d) => d.map((p) => (p.priority === priority ? { ...p, [key]: value } : p)));

  return (
    <div className="fade-in">
      <PageHeader
        title="SLA policies"
        description="Targets per priority. The scheduler checks open incidents every 30 seconds, flags them at 75% of the window and escalates on breach."
        actions={
          <Button variant="outline" icon={<Play className="h-4 w-4" />} loading={scan.isPending} onClick={() => scan.mutate()}>
            Run scan now
          </Button>
        }
      />
      <Card padded={false}>
        {error ? (
          <ErrorState error={error} retry={refetch} />
        ) : isLoading ? (
          <div className="p-5">
            <LoadingBlock rows={4} />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs tracking-wide text-faint uppercase">
                    <th className="px-5 py-2.5 font-medium">Priority</th>
                    <th className="px-3 py-2.5 font-medium">First response (min)</th>
                    <th className="px-3 py-2.5 font-medium">Resolution (min)</th>
                    <th className="px-5 py-2.5 font-medium">At-risk from</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {draft.map((p) => (
                    <tr key={p.priority}>
                      <td className="px-5 py-3">
                        <PriorityBadge priority={p.priority} />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <Input type="number" min={1} className="w-28" value={p.responseMinutes} onChange={(e) => setField(p.priority, 'responseMinutes', Number(e.target.value))} aria-label={`P${p.priority} response minutes`} />
                          <span className="text-xs text-faint">{minutesLabel(p.responseMinutes)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <Input type="number" min={1} className="w-28" value={p.resolutionMinutes} onChange={(e) => setField(p.priority, 'resolutionMinutes', Number(e.target.value))} aria-label={`P${p.priority} resolution minutes`} />
                          <span className="text-xs text-faint">{minutesLabel(p.resolutionMinutes)}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-xs text-muted">{minutesLabel(Math.round(p.resolutionMinutes * 0.75))} after opening</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-line px-5 py-3">
              <p className="text-xs text-muted">{invalid ? 'Response target must be positive and not exceed the resolution target.' : dirty ? 'Unsaved changes' : 'Saved'}</p>
              <Button icon={<Save className="h-4 w-4" />} disabled={!dirty || invalid} loading={save.isPending} onClick={() => save.mutate()}>
                Save policies
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
