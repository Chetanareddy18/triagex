import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ArrowLeft,
  BrainCircuit,
  CheckCircle2,
  CircleDot,
  Copy,
  FileText,
  Lock,
  MessageSquare,
  Play,
  RotateCcw,
  Send,
  ShieldAlert,
  Sparkles,
  UserCheck,
  Wand2,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { PriorityBadge, SlaBadge, SlaBar, StatusBadge } from '../components/badges';
import { SimilarList, TriagePanel } from '../components/TriagePanel';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Field, LoadingBlock, Modal, Select, Skeleton, Textarea } from '../components/ui';
import { isStaff, useAuth } from '../context/AuthContext';
import { useIncidentRoom } from '../context/RealtimeContext';
import { api, errorMessage } from '../lib/api';
import { ago, CATEGORIES, CATEGORY_LABEL, CHANNEL_LABEL, dateTime, PRIORITY_LABEL, refId, refName, until } from '../lib/format';
import type { Agent, Comment, Incident, SimilarIncident, Status } from '../lib/types';

const TRANSITION_UI: Record<string, { label: string; icon: ReactNode; variant?: 'primary' | 'outline' | 'secondary' }> = {
  assigned: { label: 'Assign', icon: <UserCheck className="h-4 w-4" /> },
  in_progress: { label: 'Start work', icon: <Play className="h-4 w-4" /> },
  resolved: { label: 'Resolve', icon: <CheckCircle2 className="h-4 w-4" /> },
  closed: { label: 'Close', icon: <Lock className="h-4 w-4" />, variant: 'outline' },
  new: { label: 'Return to queue', icon: <RotateCcw className="h-4 w-4" />, variant: 'outline' },
};

function transitionLabel(from: Status, to: Status) {
  if (to === 'assigned' && (from === 'resolved' || from === 'closed')) return { label: 'Reopen', icon: <RotateCcw className="h-4 w-4" />, variant: 'outline' as const };
  if (to === 'assigned' && from === 'in_progress') return { label: 'Hand back', icon: <RotateCcw className="h-4 w-4" />, variant: 'outline' as const };
  return TRANSITION_UI[to];
}

const TIMELINE_ICON: Record<string, ReactNode> = {
  created: <CircleDot className="h-3.5 w-3.5" />,
  ai_triage: <BrainCircuit className="h-3.5 w-3.5" />,
  status: <Play className="h-3.5 w-3.5" />,
  assignment: <UserCheck className="h-3.5 w-3.5" />,
  comment: <MessageSquare className="h-3.5 w-3.5" />,
  note: <Lock className="h-3.5 w-3.5" />,
  sla_breached: <ShieldAlert className="h-3.5 w-3.5" />,
  sla_at_risk: <ShieldAlert className="h-3.5 w-3.5" />,
  alert_duplicate: <Copy className="h-3.5 w-3.5" />,
};

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-ink">{children}</dd>
    </div>
  );
}

export default function IncidentDetail() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const staff = isStaff(user);
  const qc = useQueryClient();
  const [resolveOpen, setResolveOpen] = useState(false);
  const [summary, setSummary] = useState('');
  const [comment, setComment] = useState('');
  const [internal, setInternal] = useState(false);
  const [pmOpen, setPmOpen] = useState(false);

  const incidentQ = useQuery({ queryKey: ['incident', id], queryFn: () => api<{ incident: Incident }>(`/api/incidents/${id}`).then((r) => r.incident) });
  const inc = incidentQ.data;
  useIncidentRoom(inc?.id);

  const commentsQ = useQuery({
    queryKey: ['comments', inc?.id],
    queryFn: () => api<{ items: Comment[] }>(`/api/incidents/${inc!.id}/comments`).then((r) => r.items),
    enabled: Boolean(inc),
  });
  const similarQ = useQuery({
    queryKey: ['similar', inc?.id],
    queryFn: () => api<{ method: string; items: SimilarIncident[] }>(`/api/incidents/${inc!.id}/similar`),
    enabled: Boolean(inc),
    staleTime: 5 * 60_000,
  });
  const agentsQ = useQuery({ queryKey: ['agents'], queryFn: () => api<{ agents: Agent[] }>('/api/users/agents').then((r) => r.agents), enabled: staff });

  // Mutations return unpopulated refs, so refetch the detail view instead of merging.
  const refresh = (_next?: Incident) => {
    void qc.invalidateQueries({ queryKey: ['incident', id] });
    void qc.invalidateQueries({ queryKey: ['incidents'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    void qc.invalidateQueries({ queryKey: ['agents'] });
  };
  const onError = (e: unknown) => toast.error(errorMessage(e));

  const transition = useMutation({
    mutationFn: (body: { to: Status; resolutionSummary?: string }) => api<{ incident: Incident }>(`/api/incidents/${inc!.id}/transition`, { method: 'POST', body }),
    onSuccess: (r, vars) => {
      refresh(r.incident);
      setResolveOpen(false);
      setSummary('');
      toast.success(`${r.incident.number} is now ${vars.to.replace('_', ' ')}`);
    },
    onError,
  });
  const assign = useMutation({
    mutationFn: (body: { assigneeId: string | null } | { auto: true }) => api<{ incident: Incident }>(`/api/incidents/${inc!.id}/assign`, { method: 'POST', body }),
    onSuccess: (r) => {
      refresh(r.incident);
      toast.success(refName(r.incident.assignee) || r.incident.assignee ? 'Assignment updated' : 'Unassigned');
    },
    onError,
  });
  const update = useMutation({
    mutationFn: (body: Partial<Pick<Incident, 'priority' | 'category'>>) => api<{ incident: Incident }>(`/api/incidents/${inc!.id}`, { method: 'PATCH', body }),
    onSuccess: (r) => {
      refresh(r.incident);
      toast.success('Incident updated');
    },
    onError,
  });
  const acceptAi = useMutation({
    mutationFn: () => api<{ incident: Incident }>(`/api/incidents/${inc!.id}/accept-ai`, { method: 'POST' }),
    onSuccess: (r) => {
      refresh(r.incident);
      toast.success('AI suggestion applied');
    },
    onError,
  });
  const addComment = useMutation({
    mutationFn: () => api(`/api/incidents/${inc!.id}/comments`, { method: 'POST', body: { body: comment, internal } }),
    onSuccess: () => {
      setComment('');
      void qc.invalidateQueries({ queryKey: ['comments', inc!.id] });
      void qc.invalidateQueries({ queryKey: ['incident', id] });
    },
    onError,
  });
  const postmortem = useMutation({
    mutationFn: () => api<{ postmortem: NonNullable<Incident['postmortem']> }>(`/api/incidents/${inc!.id}/postmortem`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['incident', id] });
      setPmOpen(true);
    },
    onError,
  });

  if (incidentQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-5 w-1/3" />
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }
  if (incidentQ.error || !inc) {
    return (
      <Card>
        <ErrorState error={incidentQ.error ?? new Error('Incident not found')} retry={incidentQ.refetch} />
      </Card>
    );
  }

  const open = ['new', 'assigned', 'in_progress'].includes(inc.status);
  const aiDiffers = inc.ai && (inc.ai.priority !== inc.priority || inc.ai.category !== inc.category);
  const assigneeId = refId(inc.assignee);

  return (
    <div className="fade-in">
      <Link to="/app/incidents" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Incidents
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-faint">{inc.number}</span>
            <PriorityBadge priority={inc.priority} />
            <StatusBadge status={inc.status} />
            <SlaBadge state={inc.sla.state} />
            {inc.reopenCount > 0 && <Badge tone="orange">Reopened x{inc.reopenCount}</Badge>}
            {inc.occurrences > 1 && <Badge tone="slate">{inc.occurrences} alerts folded</Badge>}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">{inc.title}</h1>
          <p className="mt-1 text-sm text-muted">
            Reported by {refName(inc.reporter) ?? 'unknown'} via {CHANNEL_LABEL[inc.channel].toLowerCase()} - {ago(inc.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {inc.allowedTransitions?.map((to) => {
            const ui = transitionLabel(inc.status, to);
            if (to === 'assigned' && inc.status === 'new' && !assigneeId && user?.role === 'admin') return null; // admins pick an assignee instead
            return (
              <Button
                key={to}
                variant={ui.variant ?? 'primary'}
                icon={ui.icon}
                loading={transition.isPending && transition.variables?.to === to}
                onClick={() => (to === 'resolved' ? setResolveOpen(true) : transition.mutate({ to }))}
              >
                {to === 'assigned' && inc.status === 'new' && user?.role === 'agent' ? 'Take it' : ui.label}
              </Button>
            );
          })}
          {staff && !open && (
            <Button variant="outline" icon={<FileText className="h-4 w-4" />} loading={postmortem.isPending} onClick={() => (inc.postmortem ? setPmOpen(true) : postmortem.mutate())}>
              {inc.postmortem ? 'View postmortem' : 'Draft postmortem'}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          <Card title="Description">
            {inc.description ? <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink">{inc.description}</p> : <p className="text-sm text-faint">No description provided.</p>}
            {inc.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {inc.tags.map((t) => (
                  <Badge key={t}>#{t}</Badge>
                ))}
              </div>
            )}
            {inc.resolution && (
              <div className="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
                <p className="text-xs font-semibold tracking-wide text-emerald-700 uppercase dark:text-emerald-400">Resolution</p>
                <p className="mt-1 text-sm">{inc.resolution.summary}</p>
                <p className="mt-2 text-xs text-muted">
                  {refName(inc.resolution.resolvedBy) ?? 'Resolved'} - {dateTime(inc.resolution.resolvedAt)}
                </p>
              </div>
            )}
          </Card>

          <Card title={`Conversation${commentsQ.data ? ` (${commentsQ.data.length})` : ''}`}>
            {commentsQ.isLoading ? (
              <LoadingBlock rows={3} />
            ) : commentsQ.error ? (
              <ErrorState error={commentsQ.error} retry={commentsQ.refetch} />
            ) : !commentsQ.data?.length ? (
              <EmptyState title="No comments yet" description="Updates and questions about this incident appear here." icon={<MessageSquare className="h-5 w-5" />} />
            ) : (
              <ul className="space-y-4">
                {commentsQ.data.map((c) => (
                  <li key={c.id} className="flex gap-3">
                    <Avatar name={c.author?.name ?? '?'} />
                    <div className={clsx('min-w-0 flex-1 rounded-lg border p-3', c.internal ? 'border-amber-500/30 bg-amber-500/5' : 'border-line bg-surface-2/40')}>
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-medium text-ink">{c.author?.name}</span>
                        <span className="text-faint capitalize">{c.author?.role}</span>
                        {c.internal && (
                          <Badge tone="amber">
                            <Lock className="h-3 w-3" /> Internal
                          </Badge>
                        )}
                        <span className="ml-auto text-faint">{ago(c.createdAt)}</span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{c.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="mt-5 border-t border-line pt-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (comment.trim()) addComment.mutate();
              }}
            >
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder={staff ? 'Reply to the reporter or add an internal note...' : 'Add a comment...'} rows={3} aria-label="Comment" />
              <div className="mt-2 flex items-center justify-between">
                {staff ? (
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted">
                    <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="h-4 w-4 accent-amber-500" />
                    Internal note (hidden from reporter)
                  </label>
                ) : (
                  <span />
                )}
                <Button type="submit" size="sm" icon={<Send className="h-3.5 w-3.5" />} loading={addComment.isPending} disabled={!comment.trim()}>
                  {internal ? 'Add note' : 'Comment'}
                </Button>
              </div>
            </form>
          </Card>

          <Card title="Timeline">
            <ol className="relative space-y-4 border-l border-line pl-6">
              {[...(inc.timeline ?? [])].reverse().map((t) => (
                <li key={t._id} className="relative">
                  <span
                    className={clsx(
                      'absolute top-0.5 -left-[33px] flex h-[18px] w-[18px] items-center justify-center rounded-full border border-line bg-surface',
                      t.type.startsWith('sla') ? 'text-red-500' : t.type === 'ai_triage' ? 'text-brand-500' : 'text-faint',
                    )}
                  >
                    {TIMELINE_ICON[t.type] ?? <CircleDot className="h-3 w-3" />}
                  </span>
                  <p className="text-sm text-ink">{t.message}</p>
                  <p className="text-xs text-faint">
                    {t.actorName ? `${t.actorName} - ` : ''}
                    <span title={dateTime(t.at)}>{ago(t.at)}</span>
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card title="Details">
            <dl className="divide-y divide-line/70">
              <DetailRow label="Assignee">
                {staff && open ? (
                  <Select
                    value={assigneeId ?? ''}
                    onChange={(e) => assign.mutate({ assigneeId: e.target.value || null })}
                    className="h-8 w-48 py-1 text-xs"
                    disabled={assign.isPending}
                    aria-label="Assignee"
                  >
                    <option value="">Unassigned</option>
                    {agentsQ.data?.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {a.load != null ? ` - load ${a.load}` : ' - admin'}
                      </option>
                    ))}
                  </Select>
                ) : (
                  (refName(inc.assignee) ?? <span className="text-faint">Unassigned</span>)
                )}
              </DetailRow>
              {staff && open && !assigneeId && (
                <div className="py-2">
                  <Button size="sm" variant="secondary" className="w-full" icon={<Wand2 className="h-3.5 w-3.5" />} loading={assign.isPending} onClick={() => assign.mutate({ auto: true })}>
                    Smart-assign to least-loaded agent
                  </Button>
                </div>
              )}
              <DetailRow label="Priority">
                {staff && open ? (
                  <Select value={inc.priority} onChange={(e) => update.mutate({ priority: Number(e.target.value) as Incident['priority'] })} className="h-8 w-48 py-1 text-xs" aria-label="Priority">
                    {[1, 2, 3, 4].map((p) => (
                      <option key={p} value={p}>
                        P{p} {PRIORITY_LABEL[p as 1]}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <PriorityBadge priority={inc.priority} />
                )}
              </DetailRow>
              <DetailRow label="Category">
                {staff && open ? (
                  <Select value={inc.category} onChange={(e) => update.mutate({ category: e.target.value as Incident['category'] })} className="h-8 w-48 py-1 text-xs" aria-label="Category">
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABEL[c]}
                      </option>
                    ))}
                  </Select>
                ) : (
                  CATEGORY_LABEL[inc.category]
                )}
              </DetailRow>
              <DetailRow label="Impact / urgency">
                {inc.impact} / {inc.urgency}
              </DetailRow>
              <DetailRow label="Opened">{dateTime(inc.createdAt)}</DetailRow>
              <DetailRow label="First response">{inc.sla.firstRespondedAt ? dateTime(inc.sla.firstRespondedAt) : <span className={inc.sla.responseBreached ? 'text-red-500' : 'text-faint'}>{inc.sla.responseBreached ? 'Missed target' : 'Pending'}</span>}</DetailRow>
            </dl>
            <div className="mt-3 rounded-lg bg-surface-2 p-3">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="text-muted">Resolution SLA</span>
                <span className="font-medium">{open ? until(inc.sla.resolutionDueAt) : dateTime(inc.sla.resolutionDueAt)}</span>
              </div>
              <SlaBar progress={inc.slaProgress ?? 0} state={inc.sla.state} />
              {inc.sla.escalationLevel > 0 && <p className="mt-2 text-xs text-red-600 dark:text-red-400">Escalated {inc.sla.escalationLevel}x after breach</p>}
            </div>
          </Card>

          {inc.ai && (
            <Card
              title={
                <span className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-brand-500" /> AI triage
                </span>
              }
              action={inc.ai.applied ? <Badge tone="green">Applied</Badge> : null}
            >
              <TriagePanel ai={inc.ai} />
              {staff && open && aiDiffers && !inc.ai.applied && (
                <Button className="mt-4 w-full" variant="secondary" size="sm" loading={acceptAi.isPending} onClick={() => acceptAi.mutate()}>
                  Apply suggestion (P{inc.ai.priority}, {CATEGORY_LABEL[inc.ai.category]})
                </Button>
              )}
            </Card>
          )}

          <Card title="Similar past incidents">
            {similarQ.isLoading ? <LoadingBlock rows={3} /> : similarQ.error ? <ErrorState error={similarQ.error} /> : <SimilarList items={similarQ.data?.items ?? []} method={similarQ.data?.method} />}
          </Card>
        </aside>
      </div>

      <Modal
        open={resolveOpen}
        onClose={() => setResolveOpen(false)}
        title={`Resolve ${inc.number}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setResolveOpen(false)}>
              Cancel
            </Button>
            <Button loading={transition.isPending} disabled={!summary.trim()} onClick={() => transition.mutate({ to: 'resolved', resolutionSummary: summary })}>
              Mark resolved
            </Button>
          </>
        }
      >
        <Field label="Resolution summary" hint="What fixed it? This is shown to the reporter and used for similar-incident suggestions.">
          <Textarea autoFocus rows={5} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </Field>
        {similarQ.data?.items.find((s) => s.resolutionSummary) && (
          <div className="mt-3 text-xs text-muted">
            <p className="mb-1 font-medium">Fixes from similar incidents:</p>
            {similarQ.data.items
              .filter((s) => s.resolutionSummary)
              .slice(0, 2)
              .map((s) => (
                <button key={s.id} type="button" className="mb-1 block text-left hover:text-ink" onClick={() => setSummary(s.resolutionSummary!)}>
                  - {s.resolutionSummary}
                </button>
              ))}
          </div>
        )}
      </Modal>

      <Modal open={pmOpen} onClose={() => setPmOpen(false)} title="Postmortem draft" wide footer={<Button onClick={() => { void navigator.clipboard.writeText(inc.postmortem?.draft ?? ''); toast.success('Copied as Markdown'); }}>Copy Markdown</Button>}>
        {inc.postmortem ? (
          <>
            <p className="mb-3 text-xs text-muted">
              Generated {ago(inc.postmortem.generatedAt)} by {inc.postmortem.provider === 'template' ? 'the built-in template (no LLM configured)' : inc.postmortem.provider}.
            </p>
            <pre className="max-h-[60vh] overflow-auto rounded-lg bg-surface-2 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">{inc.postmortem.draft}</pre>
          </>
        ) : (
          <LoadingBlock />
        )}
      </Modal>
    </div>
  );
}
