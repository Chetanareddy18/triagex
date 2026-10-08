import { Schema, model, type Types } from 'mongoose';
import type { Priority } from '../lib/domain.js';
import { jsonTransform } from './json.js';

// ---------------------------------------------------------------- comments
export interface IComment {
  _id: Types.ObjectId;
  incident: Types.ObjectId;
  author: Types.ObjectId;
  body: string;
  internal: boolean;
  createdAt: Date;
}

const commentSchema = new Schema<IComment>(
  {
    incident: { type: Schema.Types.ObjectId, ref: 'Incident', required: true, index: true },
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, maxlength: 5000 },
    internal: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
commentSchema.set('toJSON', { transform: jsonTransform() });
export const Comment = model<IComment>('Comment', commentSchema);

// ---------------------------------------------------------------- notifications
export interface INotification {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  type: 'assigned' | 'comment' | 'sla_at_risk' | 'sla_breached' | 'status' | 'escalated' | 'mention';
  title: string;
  body: string;
  incident?: Types.ObjectId | null;
  incidentNumber?: string;
  readAt?: Date | null;
  createdAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    incident: { type: Schema.Types.ObjectId, ref: 'Incident', default: null },
    incidentNumber: String,
    readAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.set('toJSON', { transform: jsonTransform() });
export const Notification = model<INotification>('Notification', notificationSchema);

// ---------------------------------------------------------------- SLA policy
export interface ISlaPolicy {
  priority: Priority;
  responseMinutes: number;
  resolutionMinutes: number;
  updatedBy?: Types.ObjectId | null;
}

const slaPolicySchema = new Schema<ISlaPolicy>(
  {
    priority: { type: Number, enum: [1, 2, 3, 4], required: true, unique: true },
    responseMinutes: { type: Number, required: true, min: 1 },
    resolutionMinutes: { type: Number, required: true, min: 1 },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
export const SlaPolicy = model<ISlaPolicy>('SlaPolicy', slaPolicySchema);

// ---------------------------------------------------------------- counters & locks
const counterSchema = new Schema<{ _id: string; seq: number }>({ _id: String, seq: { type: Number, default: 0 } });
export const Counter = model('Counter', counterSchema);

export async function nextSequence(name: string): Promise<number> {
  const doc = await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
  return doc.seq;
}

const lockSchema = new Schema<{ _id: string; owner: string; lockedUntil: Date }>({
  _id: String,
  owner: String,
  lockedUntil: Date,
});
export const JobLock = model('JobLock', lockSchema);
