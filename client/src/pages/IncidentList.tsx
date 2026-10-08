import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Copy, Plus, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PriorityBadge, SlaBadge, SlaBar, StatusBadge } from '../components/badges';
import { Avatar, Button, Card, EmptyState, ErrorState, Input, LoadingBlock, PageHeader, Select } from '../components/ui';
import { isStaff, useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { ago, CATEGORIES, CATEGORY_LABEL, refName, STATUS_LABEL, STATUSES, until } from '../lib/format';
import type { Incident, Paged } from '../lib/types';

const SORTS = [
  { value: '-createdAt', label: 'Newest first' },
  { value: 'createdAt', label: 'Oldest first' },
  { value: 'priority', label: 'Priority (P1 first)' },
  { value: 'sla.resolutionDueAt', label: 'SLA due soonest' },
  { value: '-updatedAt', label: 'Recently updated' },
];

export default function IncidentList() {
  const { user } = useAuth();
  const staff = isStaff(user);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');

  const get = (k: string) => params.get(k) ?? '';
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  // Debounce the search box into the URL.
  useEffect(() => {
    const id = window.setTimeout(() => {
      if ((params.get('q') ?? '') !== q) set({ q: q || null });
    }, 300);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const page = Number(get('page') || 1);
  const query = {
    q: get('q'),
    status: get('status'),
    priority: get('priority'),
    category: get('category'),
    sla: get('sla'),
    assignee: get('assignee'),
    open: get('open'),
    sort: get('sort') || '-createdAt',
    page,
    limit: 15,
  };
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['incidents', 'list', query],
    queryFn: () => api<Paged<Incident>>('/api/incidents', { query }),
    placeholderData: keepPreviousData,
  });

  const activeFilters = ['q', 'status', 'priority', 'category', 'sla', 'assignee', 'open'].filter((k) => get(k));

  return (
    <div className="fade-in">
      <PageHeader
        title={staff ? 'Incidents' : 'My incidents'}
        description={data ? `${data.total} incident${data.total === 1 ? '' : 's'}${activeFilters.length ? ' match your filters' : ''}` : 'Loading...'}
        actions={
          <Link to="/app/incidents/new">
            <Button icon={<Plus className="h-4 w-4" />}>Report incident</Button>
          </Link>
        }
      />

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, description, tags or INC-number" className="pl-9" aria-label="Search incidents" />
          </div>
          <Select value={get('open') === 'true' ? 'open' : get('status')} onChange={(e) => (e.target.value === 'open' ? set({ open: 'true', status: null }) : set({ status: e.target.value || null, open: null }))} className="w-auto" aria-label="Status">
            <option value="">Any status</option>
            <option value="open">All open</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <Select value={get('priority')} onChange={(e) => set({ priority: e.target.value || null })} className="w-auto" aria-label="Priority">
            <option value="">Any priority</option>
            <option value="1">P1 Critical</option>
            <option value="2">P2 High</option>
            <option value="3">P3 Moderate</option>
            <option value="4">P4 Low</option>
          </Select>
          <Select value={get('category')} onChange={(e) => set({ category: e.target.value || null })} className="w-auto" aria-label="Category">
            <option value="">Any category</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </Select>
          <Select value={get('sla')} onChange={(e) => set({ sla: e.target.value || null })} className="w-auto" aria-label="SLA">
            <option value="">Any SLA</option>
            <option value="on_track">On track</option>
            <option value="at_risk">At risk</option>
            <option value="breached">Breached</option>
            <option value="met">Met</option>
          </Select>
          {staff && (
            <Select value={get('assignee')} onChange={(e) => set({ assignee: e.target.value || null })} className="w-auto" aria-label="Assignee">
              <option value="">Anyone</option>
              <option value="me">Assigned to me</option>
              <option value="unassigned">Unassigned</option>
            </Select>
          )}
          <Select value={query.sort} onChange={(e) => set({ sort: e.target.value })} className="w-auto" aria-label="Sort">
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
          {activeFilters.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              icon={<X className="h-3.5 w-3.5" />}
              onClick={() => {
                setQ('');
                setParams(new URLSearchParams(), { replace: true });
              }}
            >
              Clear
            </Button>
          )}
        </div>

        {error ? (
          <ErrorState error={error} retry={refetch} />
        ) : isLoading ? (
          <div className="p-4">
            <LoadingBlock rows={8} />
          </div>
        ) : !data?.items.length ? (
          <EmptyState
            title={activeFilters.length ? 'No incidents match these filters' : 'No incidents yet'}
            description={activeFilters.length ? 'Try removing a filter or searching for something else.' : 'Reported incidents will show up here.'}
            action={
              activeFilters.length ? undefined : (
                <Link to="/app/incidents/new">
                  <Button size="sm">Report the first one</Button>
                </Link>
              )
            }
          />
        ) : (
          <div className={clsx('transition-opacity', isFetching && 'opacity-60')}>
            {/* Desktop table */}
            <table className="hidden w-full text-sm md:table">
              <thead>
                <tr className="border-b border-line text-left text-xs tracking-wide text-faint uppercase">
                  <th className="px-4 py-2.5 font-medium">Incident</th>
                  <th className="px-3 py-2.5 font-medium">Priority</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="w-44 px-3 py-2.5 font-medium">SLA</th>
                  <th className="px-3 py-2.5 font-medium">Assignee</th>
                  <th className="px-4 py-2.5 text-right font-medium">Opened</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((i) => (
                  <tr key={i.id} className="cursor-pointer transition hover:bg-surface-2/70" onClick={() => navigate(`/app/incidents/${i.id}`)}>
                    <td className="max-w-0 px-4 py-3">
                      <Link to={`/app/incidents/${i.id}`} className="block truncate font-medium text-ink hover:text-brand-600" onClick={(e) => e.stopPropagation()}>
                        {i.title}
                      </Link>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-faint">
                        <span className="font-mono">{i.number}</span>
                        <span>{CATEGORY_LABEL[i.category]}</span>
                        {i.occurrences > 1 && (
                          <span className="inline-flex items-center gap-0.5" title="Duplicate alerts folded into this incident">
                            <Copy className="h-3 w-3" />x{i.occurrences}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <PriorityBadge priority={i.priority} />
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={i.status} />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <SlaBadge state={i.sla.state} />
                        {['new', 'assigned', 'in_progress'].includes(i.status) && <span className="text-[11px] text-faint">{until(i.sla.resolutionDueAt)}</span>}
                      </div>
                      <div className="mt-1.5">
                        <SlaBar progress={i.slaProgress ?? 0} state={i.sla.state} />
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {refName(i.assignee) ? (
                        <span className="flex items-center gap-2">
                          <Avatar name={refName(i.assignee)!} size="sm" />
                          <span className="truncate">{refName(i.assignee)}</span>
                        </span>
                      ) : (
                        <span className="text-faint">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-xs whitespace-nowrap text-muted">{ago(i.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Mobile cards */}
            <ul className="divide-y divide-line md:hidden">
              {data.items.map((i) => (
                <li key={i.id}>
                  <Link to={`/app/incidents/${i.id}`} className="block space-y-2 p-4">
                    <div className="flex items-center gap-2">
                      <PriorityBadge priority={i.priority} compact />
                      <StatusBadge status={i.status} />
                      <span className="ml-auto font-mono text-xs text-faint">{i.number}</span>
                    </div>
                    <p className="font-medium">{i.title}</p>
                    <SlaBar progress={i.slaProgress ?? 0} state={i.sla.state} />
                    <p className="text-xs text-muted">
                      {refName(i.assignee) ?? 'Unassigned'} - {ago(i.createdAt)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-muted">
              <span>
                Page {data.page} of {data.pages}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" icon={<ChevronLeft className="h-4 w-4" />} disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page >= data.pages} onClick={() => set({ page: String(page + 1) })}>
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
