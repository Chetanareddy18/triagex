import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { ROLES, type Role } from '../lib/domain.js';
import { jsonTransform } from './json.js';

export interface IUser {
  _id: Types.ObjectId;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  active: boolean;
  title?: string;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'reporter', index: true },
    active: { type: Boolean, default: true },
    title: { type: String, trim: true, maxlength: 80 },
    lastLoginAt: Date,
  },
  { timestamps: true },
);

userSchema.set('toJSON', { transform: jsonTransform('passwordHash') });

export type UserDoc = HydratedDocument<IUser>;
export const User = model<IUser>('User', userSchema);

export function publicUser(u: Pick<IUser, '_id' | 'name' | 'email' | 'role'> & Partial<IUser>) {
  return { id: String(u._id), name: u.name, email: u.email, role: u.role, title: u.title, active: u.active };
}
