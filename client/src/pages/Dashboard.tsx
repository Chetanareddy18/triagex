import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, CheckCircle2, Flame, Gauge, Sparkles, Timer, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { PriorityBadge, SlaBadge, SlaBar, StatusBadge } from '../components/badges';
import { SimpleBars, TrendChart } from '../components/charts';
import { Avatar, Button, Card, EmptyState, ErrorState, LoadingBlock, PageHeader, Select, Skeleton, Stat } from '../components/ui';
import { isStaff, useAuth } from '../context/AuthContext';
import { api, errorMessage } from '../lib/api';
import { hours, PRIORITY_LABEL, refName, until } from '../lib/format';
import type { DashboardSummary, Incident, Paged } from '../lib/types';

function UrgentQueue() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['incidents', 'urgent'],
    queryFn: () => api<Paged<Incident>>('/api/incidents', { query: { open: true, sort: 'sla.resolutionDueAt', limit: 6 } }),
  });
  if (isLoading) return <LoadingBlock rows={5} />;
  if (error) return <ErrorState error={error} retry={refetch} />;
  if (!data?.items.length) return <EmptyState title="Queue is clear" description="No open incidents right now." icon={<CheckCircle2 className="h-5 w-5" />} />;
  return (
    <ul className="divide-y divide-line">
      {data.items.map((i) => (
        <li key={i.id}>
          <Link to={`/app/incidents/${i.id}`} className="flex items-center gap-3 px-5 py-3 transition hover:bg-surface-2">
            <PriorityBadge priority={i.priority} compact />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{i.title}</p>
              <div className="mt-1.5 flex items-center gap-2 text-xs text-muted">
                <span className="font-mono">{i.number}</span>
                <span className="w-20">
                  <SlaBar progress={i.slaProgress ?? 0} state={i.sla.state} />
                </span>
                <span>{until(i.sla.resolutionDueAt)}</span>
              </div>
            </div>
            <div className="hidden flex-col items-end gap-1 sm:flex">
              <SlaBadge state={i.sla.state} />
              <span className="text-xs text-faint">{refName(i.assignee) ?? 'Unassigned'}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const staff = isStaff(user);
  const [days, setDays] = useState(30);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard', days],
    queryFn: () => api<DashboardSummary>('/api/dashboard/summary', { query: { days } }),
  });
  const autoAssign = useMutation({
    mutationFn: () => api<{ assigned: number; plan: { incident: string; agent: string }[] }>('/api/incidents/auto-assign', { method: 'POST' }),
    onSuccess: (r) => {
      toast.success(r.assigned ? `Assigned ${r.assigned} incident${r.assigned > 1 ? 's' : ''}` : 'Queue already assigned', {
        description: r.plan
          .slice(0, 4)
          .map((p) => `${p.incident} -> ${p.agent}`)
          .join(', '),
      });
      void qc.invalidateQueries({ queryKey: ['incidents'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const maxLoad = Math.max(1, ...(data?.workload.map((w) => w.load) ?? [1]));

  return (
    <div className="fade-in">
      <PageHeader
        title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, ${user?.name.split(' ')[0]}`}
        description={staff ? 'Service health, SLA exposure and team workload at a glance.' : 'The status of incidents you have reported.'}
        actions={
          <>
            <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-36" aria-label="Time window">
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </Select>
            {staff && (
              <Button icon={<Wand2 className="h-4 w-4" />} onClick={() => autoAssign.mutate()} loading={autoAssign.isPending}>
                Smart-assign queue
              </Button>
            )}
          </>
        }
      />

      {error ? (
        <Card>
          <ErrorState error={error} retry={refetch} />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
            {isLoading || !data ? (
              Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[118px] rounded-xl" />)
            ) : (
              <>
                <Stat label="Open" value={data.totals.open} sub={`${data.totals.createdInWindow} created in window`} icon={<Gauge className="h-4 w-4" />} />
                <Stat label="At risk" value={data.totals.openAtRisk} tone={data.totals.openAtRisk ? 'amber' : undefined} sub="past 75% of SLA window" icon={<AlarmClock className="h-4 w-4" />} />
                <Stat label="Breached" value={data.totals.openBreached} tone={data.totals.openBreached ? 'red' : undefined} sub="open and overdue" icon={<Flame className="h-4 w-4" />} />
                <Stat label="MTTR" value={hours(data.mttrHours)} sub={`median ${hours(data.medianTtrHours)}`} icon={<Timer className="h-4 w-4" />} />
                <Stat
                  label="SLA compliance"
                  value={data.slaCompliance == null ? '-' : `${data.slaCompliance}%`}
                  tone={data.slaCompliance != null ? (data.slaCompliance >= 90 ? 'green' : data.slaCompliance >= 75 ? 'amber' : 'red') : undefined}
                  sub={`${data.totals.resolvedInWindow} resolved`}
                  icon={<CheckCircle2 className="h-4 w-4" />}
                />
                <Stat label="AI agreement" value={data.aiAgreement == null ? '-' : `${data.aiAgreement}%`} sub="final priority = AI suggestion" icon={<Sparkles className="h-4 w-4" />} />
              </>
            )}
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-3">
            <Card title="Created vs resolved" className="xl:col-span-2">
              {isLoading || !data ? <Skeleton className="h-[260px]" /> : <TrendChart data={data.trend} />}
            </Card>
            <Card title="Open by priority">
              {isLoading || !data ? (
                <Skeleton className="h-[260px]" />
              ) : (
                <SimpleBars
                  height={260}
                  data={data.openByPriority.map((p) => ({ label: `P${p.priority} ${PRIORITY_LABEL[p.priority]}`, value: p.count, id: String(p.priority) }))}
                  onSelect={(p) => navigate(`/app/incidents?priority=${p}&open=true`)}
                />
              )}
            </Card>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-3">
            <Card title="Most urgent open incidents" className="xl:col-span-2" padded={false} action={<Link to="/app/incidents?open=true" className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">View all</Link>}>
              <UrgentQueue />
            </Card>
            {staff ? (
              <Card title="Agent workload" padded={false}>
                {isLoading || !data ? (
                  <div className="p-5">
                    <LoadingBlock rows={4} />
                  </div>
                ) : !data.workload.length ? (
                  <EmptyState title="No agents yet" />
                ) : (
                  <ul className="divide-y divide-line">
                    {data.workload.map((w) => (
                      <li key={w.id} className="flex items-center gap-3 px-5 py-3">
                        <Avatar name={w.name} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="truncate text-sm font-medium">{w.name}</p>
                            <p className="text-xs text-muted tabular-nums">
                              {w.open} open{w.p1 ? `, ${w.p1} P1` : ''}
                            </p>
                          </div>
                          <div className="mt-1.5 flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2" title={`Weighted load ${w.load}`}>
                              <div className="h-full rounded-full" style={{ width: `${(w.load / maxLoad) * 100}%`, background: 'var(--viz-1)' }} />
                            </div>
                            <span className="w-8 text-right text-[11px] text-faint tabular-nums">{w.load}</span>
                          </div>
                          <p className="mt-1 text-[11px] text-faint">{w.resolved} resolved in window</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ) : (
              <Card title="By status">
                {isLoading || !data ? (
                  <LoadingBlock rows={4} />
                ) : (
                  <ul className="space-y-3">
                    {data.byStatus.map((s) => (
                      <li key={s.status} className="flex items-center justify-between">
                        <StatusBadge status={s.status} />
                        <span className="text-sm font-medium tabular-nums">{s.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}
