export const ROLES = ['reporter', 'agent', 'admin'] as const;
export type Role = (typeof ROLES)[number];
export const STAFF_ROLES: readonly Role[] = ['agent', 'admin'];

export const STATUSES = ['new', 'assigned', 'in_progress', 'resolved', 'closed'] as const;
export type Status = (typeof STATUSES)[number];
export const OPEN_STATUSES: readonly Status[] = ['new', 'assigned', 'in_progress'];

export const PRIORITIES = [1, 2, 3, 4] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<Priority, string> = { 1: 'Critical', 2: 'High', 3: 'Moderate', 4: 'Low' };
/** Workload weight per priority used by smart assignment. */
export const PRIORITY_WEIGHT: Record<Priority, number> = { 1: 8, 2: 4, 3: 2, 4: 1 };

export const CATEGORIES = ['network', 'hardware', 'software', 'access', 'database', 'security', 'email', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CHANNELS = ['portal', 'email', 'phone', 'monitoring'] as const;
export type Channel = (typeof CHANNELS)[number];

export const SLA_STATES = ['on_track', 'at_risk', 'breached', 'met'] as const;
export type SlaState = (typeof SLA_STATES)[number];

/** ITIL impact x urgency matrix (1 = highest). Same rule as the UCI training data. */
export function itilPriority(impact: number, urgency: number): Priority {
  const total = impact + urgency;
  if (total <= 2) return 1;
  if (total === 3) return 2;
  if (total === 4) return 3;
  return 4;
}

export const DEFAULT_SLA_POLICIES: { priority: Priority; responseMinutes: number; resolutionMinutes: number }[] = [
  { priority: 1, responseMinutes: 15, resolutionMinutes: 4 * 60 },
  { priority: 2, responseMinutes: 60, resolutionMinutes: 8 * 60 },
  { priority: 3, responseMinutes: 4 * 60, resolutionMinutes: 24 * 60 },
  { priority: 4, responseMinutes: 8 * 60, resolutionMinutes: 72 * 60 },
];
