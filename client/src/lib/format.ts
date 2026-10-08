import { formatDistanceToNowStrict, format } from 'date-fns';
import type { Category, Channel, Priority, SlaState, Status, UserRef } from './types';

export const PRIORITY_LABEL: Record<Priority, string> = { 1: 'Critical', 2: 'High', 3: 'Moderate', 4: 'Low' };
export const STATUS_LABEL: Record<Status, string> = {
  new: 'New',
  assigned: 'Assigned',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
};
export const SLA_LABEL: Record<SlaState, string> = { on_track: 'On track', at_risk: 'At risk', breached: 'Breached', met: 'Met' };
export const CATEGORY_LABEL: Record<Category, string> = {
  network: 'Network',
  hardware: 'Hardware',
  software: 'Software',
  access: 'Access',
  database: 'Database',
  security: 'Security',
  email: 'Email',
  other: 'Other',
};
export const CHANNEL_LABEL: Record<Channel, string> = { portal: 'Web portal', email: 'Email', phone: 'Phone', monitoring: 'Monitoring alert' };
export const CATEGORIES = Object.keys(CATEGORY_LABEL) as Category[];
export const STATUSES = Object.keys(STATUS_LABEL) as Status[];

export const ago = (iso?: string | null) => (iso ? `${formatDistanceToNowStrict(new Date(iso))} ago` : '-');
export const until = (iso: string) => {
  const d = new Date(iso);
  const diff = d.getTime() - Date.now();
  const words = formatDistanceToNowStrict(d);
  return diff >= 0 ? `in ${words}` : `${words} overdue`;
};
export const dateTime = (iso?: string | null) => (iso ? format(new Date(iso), 'd MMM yyyy, HH:mm') : '-');
export const shortDate = (iso: string) => format(new Date(iso), 'd MMM');
export const pct = (x: number | null | undefined, digits = 0) => (x == null ? '-' : `${(x * 100).toFixed(digits)}%`);
export const hours = (h: number | null | undefined) => {
  if (h == null) return '-';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} d`;
};
export const minutesLabel = (m: number) => (m < 60 ? `${m} min` : m % 60 === 0 ? `${m / 60} h` : `${(m / 60).toFixed(1)} h`);

export const refName = (ref: UserRef | string | null | undefined) => (ref && typeof ref === 'object' ? ref.name : null);
export const refId = (ref: UserRef | string | null | undefined) =>
  ref == null ? null : typeof ref === 'string' ? ref : (ref.id ?? ref._id ?? null);

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
