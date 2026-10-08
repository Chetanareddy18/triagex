import type { Types } from 'mongoose';
import { Notification, type INotification } from '../models/misc.js';
import { User } from '../models/User.js';
import { emitTo, rooms } from './realtime.js';

interface NotifyInput {
  type: INotification['type'];
  title: string;
  body?: string;
  incident?: { _id: Types.ObjectId; number: string } | null;
}

/** Persists one notification per recipient and pushes it to their socket room. */
export async function notify(userIds: Iterable<string | Types.ObjectId | null | undefined>, input: NotifyInput, exclude?: string) {
  const unique = [...new Set([...userIds].filter(Boolean).map(String))].filter((id) => id !== exclude);
  if (unique.length === 0) return [];
  const docs = await Notification.insertMany(
    unique.map((user) => ({
      user,
      type: input.type,
      title: input.title,
      body: input.body ?? '',
      incident: input.incident?._id ?? null,
      incidentNumber: input.incident?.number,
    })),
  );
  for (const doc of docs) emitTo(rooms.user(String(doc.user)), 'notification:new', doc.toJSON());
  return docs;
}

export async function adminIds(): Promise<string[]> {
  const admins = await User.find({ role: 'admin', active: true }, { _id: 1 }).lean();
  return admins.map((a) => String(a._id));
}

export async function staffIds(): Promise<string[]> {
  const staff = await User.find({ role: { $in: ['agent', 'admin'] }, active: true }, { _id: 1 }).lean();
  return staff.map((a) => String(a._id));
}
