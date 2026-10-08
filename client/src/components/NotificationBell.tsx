import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertOctagon, Bell, CheckCheck, Clock, MessageSquare, UserPlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { ago } from '../lib/format';
import type { Notification } from '../lib/types';
import { Spinner } from './ui';

const ICONS: Record<string, typeof Bell> = { sla_breached: AlertOctagon, sla_at_risk: Clock, comment: MessageSquare, assigned: UserPlus };

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ items: Notification[]; unread: number }>('/api/notifications'),
    refetchInterval: 60_000,
  });
  const readAll = useMutation({
    mutationFn: () => api('/api/notifications/read-all', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const readOne = useMutation({
    mutationFn: (id: string) => api(`/api/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const unread = data?.unread ?? 0;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg p-2 text-muted transition hover:bg-surface-2 hover:text-ink"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
      >
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="card fade-in absolute right-0 z-40 mt-2 w-[min(92vw,380px)] overflow-hidden shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            <button
              className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-400"
              onClick={() => readAll.mutate()}
              disabled={!unread}
            >
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </button>
          </div>
          <div className="max-h-[420px] overflow-auto">
            {isLoading ? (
              <div className="flex justify-center p-6">
                <Spinner />
              </div>
            ) : !data?.items.length ? (
              <p className="p-6 text-center text-sm text-muted">You are all caught up.</p>
            ) : (
              data.items.map((n) => {
                const Icon = ICONS[n.type] ?? Bell;
                return (
                  <button
                    key={n.id}
                    onClick={() => {
                      if (!n.readAt) readOne.mutate(n.id);
                      if (n.incident) navigate(`/app/incidents/${n.incident}`);
                      setOpen(false);
                    }}
                    className={clsx('flex w-full gap-3 border-b border-line/60 px-4 py-3 text-left transition last:border-0 hover:bg-surface-2', !n.readAt && 'bg-brand-500/[0.04]')}
                  >
                    <Icon className={clsx('mt-0.5 h-4 w-4 shrink-0', n.type === 'sla_breached' ? 'text-red-500' : n.type === 'sla_at_risk' ? 'text-amber-500' : 'text-faint')} />
                    <div className="min-w-0 flex-1">
                      <p className={clsx('truncate text-sm', !n.readAt ? 'font-medium text-ink' : 'text-muted')}>{n.title}</p>
                      {n.body && <p className="truncate text-xs text-muted">{n.body}</p>}
                      <p className="mt-0.5 text-[11px] text-faint">{ago(n.createdAt)}</p>
                    </div>
                    {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
