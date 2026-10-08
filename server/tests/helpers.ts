import request from 'supertest';
import { createApp } from '../src/app.js';
import type { Role } from '../src/lib/domain.js';
import { User } from '../src/models/User.js';
import { hashPassword, signAccessToken } from '../src/services/auth.js';

export const app = createApp();
export const api = () => request(app);

export const PASSWORD = 'Passw0rd!';

export async function makeUser(role: Role, name = `${role}-${Math.random().toString(36).slice(2, 7)}`) {
  const user = await User.create({
    name,
    email: `${name.toLowerCase().replace(/\s+/g, '.')}@test.dev`,
    passwordHash: await hashPassword(PASSWORD),
    role,
  });
  return { user, token: signAccessToken(user), id: String(user._id) };
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function createIncident(token: string, body: Record<string, unknown> = {}) {
  const res = await api()
    .post('/api/incidents')
    .set(auth(token))
    .send({ title: 'VPN disconnects every few minutes', description: 'Remote users lose VPN connection', ...body });
  if (res.status !== 201) throw new Error(`create failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.incident as { id: string; number: string; priority: number; status: string; [k: string]: unknown };
}
