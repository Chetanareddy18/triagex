import { useMutation, useQuery } from '@tanstack/react-query';
import { BrainCircuit, Send } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { SimilarList, TriagePanel } from '../components/TriagePanel';
import { Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { CATEGORIES, CATEGORY_LABEL, CHANNEL_LABEL } from '../lib/format';
import type { AiTriage, Category, Channel, Incident, SimilarIncident } from '../lib/types';

const LEVELS = [
  { v: 1, impact: 'High - many users or a key service', urgency: 'High - work is blocked now' },
  { v: 2, impact: 'Medium - a team or part of a service', urgency: 'Medium - degraded, workaround exists' },
  { v: 3, impact: 'Low - one person', urgency: 'Low - can wait' },
] as const;

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

export default function NewIncident() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ title: '', description: '', category: '' as Category | '', channel: 'portal' as Channel, impact: 2, urgency: 2, tags: '' });
  const debounced = useDebounced({ title: form.title, description: form.description, impact: form.impact, urgency: form.urgency, channel: form.channel }, 600);
  const canPreview = debounced.title.trim().length >= 5;

  const preview = useQuery({
    queryKey: ['triage-preview', debounced],
    queryFn: () => api<{ ai: AiTriage; similar: { method: string; items: SimilarIncident[] } }>('/api/incidents/triage-preview', { method: 'POST', body: debounced }),
    enabled: canPreview,
    staleTime: 60_000,
  });

  const create = useMutation({
    mutationFn: () =>
      api<{ incident: Incident }>('/api/incidents', {
        method: 'POST',
        body: {
          title: form.title,
          description: form.description,
          channel: form.channel,
          impact: form.impact,
          urgency: form.urgency,
          ...(form.category ? { category: form.category } : {}),
          ...(form.tags.trim() ? { tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean) } : {}),
        },
      }),
    onSuccess: ({ incident }) => {
      toast.success(`${incident.number} created`, { description: `Priority P${incident.priority}${incident.ai?.applied ? ' (set by AI triage)' : ''}` });
      navigate(`/app/incidents/${incident.id}`);
    },
    onError: (e) => toast.error('Could not create incident', { description: errorMessage(e) }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <div className="fade-in">
      <PageHeader title="Report an incident" description="Describe what is happening. TriageX suggests priority and category as you type and surfaces similar past incidents." />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <form onSubmit={submit} className="space-y-5">
            <Field label="Title" htmlFor="title" hint="A short summary, e.g. 'VPN disconnects every few minutes for Pune staff'">
              <Input id="title" value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })} required minLength={5} autoFocus />
            </Field>
            <Field label="Description" htmlFor="desc" hint="What changed, who is affected, any error messages.">
              <Textarea id="desc" rows={6} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Impact" htmlFor="impact">
                <Select id="impact" value={form.impact} onChange={(e) => setForm({ ...form, impact: Number(e.target.value) })}>
                  {LEVELS.map((l) => (
                    <option key={l.v} value={l.v}>
                      {l.impact}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Urgency" htmlFor="urgency">
                <Select id="urgency" value={form.urgency} onChange={(e) => setForm({ ...form, urgency: Number(e.target.value) })}>
                  {LEVELS.map((l) => (
                    <option key={l.v} value={l.v}>
                      {l.urgency}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Category" htmlFor="category" hint="Leave on auto to accept the AI suggestion.">
                <Select id="category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Category })}>
                  <option value="">Auto-detect</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Reported via" htmlFor="channel">
                <Select id="channel" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value as Channel })}>
                  {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => (
                    <option key={c} value={c}>
                      {CHANNEL_LABEL[c]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Tags" htmlFor="tags" hint="Optional, comma separated.">
              <Input id="tags" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="vpn, pune" />
            </Field>
            <div className="flex justify-end gap-2 border-t border-line pt-5">
              <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
                Cancel
              </Button>
              <Button type="submit" loading={create.isPending} disabled={form.title.trim().length < 5} icon={<Send className="h-4 w-4" />}>
                Submit incident
              </Button>
            </div>
          </form>
        </Card>

        <div className="space-y-6 lg:sticky lg:top-20 lg:self-start">
          <Card
            title={
              <span className="flex items-center gap-2">
                <BrainCircuit className="h-4 w-4 text-brand-500" /> Live triage
              </span>
            }
            action={preview.isFetching ? <Spinner className="h-4 w-4" /> : null}
          >
            {!canPreview ? (
              <EmptyState title="Start typing a title" description="Suggestions appear after a few words." icon={<BrainCircuit className="h-5 w-5" />} />
            ) : preview.error ? (
              <p className="text-sm text-muted">Triage preview unavailable: {errorMessage(preview.error)}</p>
            ) : !preview.data ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : (
              <TriagePanel ai={preview.data.ai} compact />
            )}
          </Card>
          <Card title="Similar past incidents">
            {!canPreview ? (
              <p className="text-sm text-muted">Similar tickets and how they were fixed will appear here.</p>
            ) : preview.data ? (
              <SimilarList items={preview.data.similar.items} method={preview.data.similar.method} />
            ) : (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
