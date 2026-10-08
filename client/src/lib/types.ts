export type Role = 'reporter' | 'agent' | 'admin';
export type Status = 'new' | 'assigned' | 'in_progress' | 'resolved' | 'closed';
export type Priority = 1 | 2 | 3 | 4;
export type SlaState = 'on_track' | 'at_risk' | 'breached' | 'met';
export type Category = 'network' | 'hardware' | 'software' | 'access' | 'database' | 'security' | 'email' | 'other';
export type Channel = 'portal' | 'email' | 'phone' | 'monitoring';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  title?: string;
  active?: boolean;
  lastLoginAt?: string;
  createdAt?: string;
}

export interface UserRef {
  id?: string;
  _id?: string;
  name: string;
  email?: string;
  role?: Role;
}

export interface AiTriage {
  priority: Priority;
  priorityConfidence: number;
  priorityDistribution: number[];
  category: Category;
  categoryConfidence: number;
  categoryKeywords?: string[];
  breachRisk: number | null;
  expectedResolutionHours: number | null;
  signals?: Record<string, unknown>;
  source: 'ml' | 'fallback';
  modelVersion: string;
  applied?: boolean;
}

export interface TimelineEvent {
  _id: string;
  type: string;
  at: string;
  actorName?: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface Incident {
  id: string;
  number: string;
  title: string;
  description: string;
  category: Category;
  channel: Channel;
  impact: 1 | 2 | 3;
  urgency: 1 | 2 | 3;
  priority: Priority;
  status: Status;
  reporter: UserRef | string;
  assignee: UserRef | string | null;
  tags: string[];
  sla: {
    responseDueAt: string;
    resolutionDueAt: string;
    firstRespondedAt?: string | null;
    responseBreached: boolean;
    state: SlaState;
    breachedAt?: string | null;
    escalationLevel: number;
  };
  slaProgress?: number;
  ai?: AiTriage | null;
  resolution?: { summary: string; resolvedAt: string; resolvedBy?: UserRef | string } | null;
  closedAt?: string | null;
  reopenCount: number;
  occurrences: number;
  postmortem?: { draft: string; provider: string; generatedAt: string } | null;
  timeline?: TimelineEvent[];
  allowedTransitions?: Status[];
  createdAt: string;
  updatedAt: string;
}

export interface SimilarIncident {
  id: string;
  number: string;
  title: string;
  status: Status;
  priority: Priority;
  category: Category;
  similarity: number;
  resolutionSummary?: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface Comment {
  id: string;
  body: string;
  internal: boolean;
  createdAt: string;
  author: { id: string; name: string; role: Role } | null;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  incident?: string | null;
  incidentNumber?: string;
  readAt?: string | null;
  createdAt: string;
}

export interface Agent {
  id: string;
  name: string;
  role: Role;
  load: number | null;
  open: number | null;
}

export interface DashboardSummary {
  windowDays: number;
  totals: { createdInWindow: number; resolvedInWindow: number; open: number; openAtRisk: number; openBreached: number };
  mttrHours: number | null;
  medianTtrHours: number | null;
  slaCompliance: number | null;
  openByPriority: { priority: Priority; count: number }[];
  byStatus: { status: Status; count: number }[];
  trend: { date: string; created: number; resolved: number; breached: number }[];
  workload: { id: string; name: string; role: Role; open: number; p1: number; load: number; resolved: number }[];
  aiAgreement: number | null;
}

export interface AuditEntry {
  seq: number;
  action: string;
  actor: string;
  actorName: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  createdAt: string;
  prevHash: string;
  hash: string;
}

export interface VerifyResult {
  ok: boolean;
  checked: number;
  headSeq: number;
  headHash: string;
  checkpointsChecked: number;
  durationMs: number;
  firstInvalid?: { seq: number; reason: string; expected: string; actual: string; entry?: Partial<AuditEntry> };
}

export interface SlaPolicy {
  priority: Priority;
  responseMinutes: number;
  resolutionMinutes: number;
}
