import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { CATEGORIES, CHANNELS, SLA_STATES, STATUSES, type Category, type Channel, type Priority, type SlaState, type Status } from '../lib/domain.js';
import { jsonTransform } from './json.js';

export interface TimelineEvent {
  _id?: Types.ObjectId;
  type: string;
  at: Date;
  actor?: Types.ObjectId | null;
  actorName?: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface AiTriage {
  priority: Priority;
  priorityConfidence: number;
  priorityDistribution: number[];
  category: Category;
  categoryConfidence: number;
  breachRisk: number | null;
  expectedResolutionHours: number | null;
  signals: Record<string, unknown>;
  source: 'ml' | 'fallback';
  modelVersion: string;
  applied: boolean;
  at: Date;
}

export interface SlaInfo {
  responseDueAt: Date;
  resolutionDueAt: Date;
  firstRespondedAt?: Date | null;
  responseBreached: boolean;
  state: SlaState;
  atRiskAt?: Date | null;
  breachedAt?: Date | null;
  escalationLevel: number;
}

export interface IIncident {
  _id: Types.ObjectId;
  number: string;
  title: string;
  description: string;
  category: Category;
  channel: Channel;
  impact: 1 | 2 | 3;
  urgency: 1 | 2 | 3;
  priority: Priority;
  status: Status;
  reporter: Types.ObjectId;
  assignee?: Types.ObjectId | null;
  tags: string[];
  sla: SlaInfo;
  ai?: AiTriage | null;
  embedding?: { model: string; vector: number[] } | null;
  resolution?: { summary: string; resolvedAt: Date; resolvedBy: Types.ObjectId } | null;
  closedAt?: Date | null;
  reopenCount: number;
  fingerprint?: string | null;
  occurrences: number;
  lastOccurrenceAt?: Date | null;
  postmortem?: { draft: string; provider: string; generatedAt: Date } | null;
  timeline: TimelineEvent[];
  createdAt: Date;
  updatedAt: Date;
}

const timelineSchema = new Schema<TimelineEvent>(
  {
    type: { type: String, required: true },
    at: { type: Date, default: () => new Date() },
    actor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actorName: String,
    message: { type: String, required: true },
    data: Schema.Types.Mixed,
  },
  { _id: true },
);

const incidentSchema = new Schema<IIncident>(
  {
    number: { type: String, required: true, unique: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 10_000 },
    category: { type: String, enum: CATEGORIES, default: 'other' },
    channel: { type: String, enum: CHANNELS, default: 'portal' },
    impact: { type: Number, enum: [1, 2, 3], default: 2 },
    urgency: { type: Number, enum: [1, 2, 3], default: 2 },
    priority: { type: Number, enum: [1, 2, 3, 4], required: true },
    status: { type: String, enum: STATUSES, default: 'new' },
    reporter: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    assignee: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    tags: { type: [String], default: [] },
    sla: {
      responseDueAt: { type: Date, required: true },
      resolutionDueAt: { type: Date, required: true },
      firstRespondedAt: { type: Date, default: null },
      responseBreached: { type: Boolean, default: false },
      state: { type: String, enum: SLA_STATES, default: 'on_track' },
      atRiskAt: { type: Date, default: null },
      breachedAt: { type: Date, default: null },
      escalationLevel: { type: Number, default: 0 },
    },
    ai: { type: Schema.Types.Mixed, default: null },
    embedding: { type: { model: String, vector: [Number] }, default: null, select: false },
    resolution: {
      type: { summary: String, resolvedAt: Date, resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' } },
      default: null,
    },
    closedAt: { type: Date, default: null },
    reopenCount: { type: Number, default: 0 },
    fingerprint: { type: String, default: null },
    occurrences: { type: Number, default: 1 },
    lastOccurrenceAt: { type: Date, default: null },
    postmortem: { type: { draft: String, provider: String, generatedAt: Date }, default: null },
    timeline: { type: [timelineSchema], default: [] },
  },
  { timestamps: true },
);

incidentSchema.index({ title: 'text', description: 'text', tags: 'text' }, { weights: { title: 5, tags: 3, description: 1 }, name: 'incident_text' });
incidentSchema.index({ status: 1, priority: 1, createdAt: -1 });
incidentSchema.index({ assignee: 1, status: 1 });
incidentSchema.index({ status: 1, 'sla.resolutionDueAt': 1 });
incidentSchema.index({ fingerprint: 1, status: 1 });
incidentSchema.index({ 'embedding.model': 1, status: 1 });

incidentSchema.set('toJSON', { transform: jsonTransform('embedding') });

export type IncidentDoc = HydratedDocument<IIncident>;
export const Incident = model<IIncident>('Incident', incidentSchema);
