import { describe, expect, it } from 'vitest';
import { RefreshToken } from '../../src/models/RefreshToken.js';
import { api, auth, makeUser, PASSWORD } from '../helpers.js';

const cookieFrom = (res: { headers: Record<string, unknown> }) => {
  const raw = (res.headers['set-cookie'] as string[] | undefined) ?? [];
  return raw.find((c) => c.startsWith('tx_refresh='))?.split(';')[0];
};

describe('auth', () => {
  it('registers a reporter, sets an httpOnly refresh cookie and returns an access token', async () => {
    const res = await api().post('/api/auth/register').send({ name: 'Ada Reporter', email: 'Ada@Example.com', password: 'abcdefg1' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'ada@example.com', role: 'reporter' });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.accessToken).toBeTypeOf('string');
    const header = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(header).toMatch(/tx_refresh=.*HttpOnly/i);
  });

  it('rejects weak passwords and duplicate emails', async () => {
    const weak = await api().post('/api/auth/register').send({ name: 'Bob', email: 'bob@example.com', password: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('VALIDATION_ERROR');
    await api().post('/api/auth/register').send({ name: 'Bob', email: 'bob@example.com', password: 'abcdefg1' });
    const dup = await api().post('/api/auth/register').send({ name: 'Bob', email: 'bob@example.com', password: 'abcdefg1' });
    expect(dup.status).toBe(409);
  });

  it('logs in, returns the same error for unknown email and wrong password', async () => {
    const { user } = await makeUser('agent', 'Grace');
    const ok = await api().post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.user.role).toBe('agent');

    const wrong = await api().post('/api/auth/login').send({ email: user.email, password: 'nope12345' });
    const unknown = await api().post('/api/auth/login').send({ email: 'ghost@test.dev', password: 'nope12345' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('blocks disabled accounts', async () => {
    const { user } = await makeUser('agent', 'Disabled');
    user.active = false;
    await user.save();
    const res = await api().post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('protects /me and rejects tampered tokens', async () => {
    expect((await api().get('/api/auth/me')).status).toBe(401);
    const { token } = await makeUser('reporter');
    expect((await api().get('/api/auth/me').set(auth(token))).status).toBe(200);
    expect((await api().get('/api/auth/me').set(auth(`${token}x`))).status).toBe(401);
  });

  it('rotates refresh tokens and detects reuse of a rotated token', async () => {
    const { user } = await makeUser('reporter', 'Rotator');
    const login = await api().post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    const first = cookieFrom(login)!;

    const refreshed = await api().post('/api/auth/refresh').set('Cookie', first);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toBeTypeOf('string');
    const second = cookieFrom(refreshed)!;
    expect(second).not.toBe(first);

    // Replaying the first (already rotated) token revokes the whole family.
    const replay = await api().post('/api/auth/refresh').set('Cookie', first);
    expect(replay.status).toBe(401);
    expect(replay.body.error.message).toMatch(/reuse/i);
    const afterTheft = await api().post('/api/auth/refresh').set('Cookie', second);
    expect(afterTheft.status).toBe(401);
    expect(await RefreshToken.countDocuments({ user: user._id, revokedAt: null })).toBe(0);
  });

  it('logout revokes the refresh token', async () => {
    const { user } = await makeUser('reporter', 'Leaver');
    const login = await api().post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    const cookie = cookieFrom(login)!;
    expect((await api().post('/api/auth/logout').set('Cookie', cookie)).status).toBe(204);
    expect((await api().post('/api/auth/refresh').set('Cookie', cookie)).status).toBe(401);
  });
});
