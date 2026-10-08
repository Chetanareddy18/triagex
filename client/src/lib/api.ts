/**
 * Fetch wrapper. The access token lives in memory only; the refresh token is an
 * httpOnly cookie scoped to /api/auth, so a 401 triggers one silent refresh + retry.
 */
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

let accessToken: string | null = null;
let refreshing: Promise<string | null> | null = null;
const listeners = new Set<(token: string | null) => void>();

export const getToken = () => accessToken;
const SESSION_HINT = 'tx-session';
/** Non-sensitive flag: "a refresh cookie probably exists", so logged-out visits skip the refresh call. */
export const hasSessionHint = () => {
  try {
    return localStorage.getItem(SESSION_HINT) === '1';
  } catch {
    return true;
  }
};
export function setToken(token: string | null) {
  accessToken = token;
  try {
    if (token) localStorage.setItem(SESSION_HINT, '1');
    else localStorage.removeItem(SESSION_HINT);
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l(token));
}
export const onTokenChange = (fn: (token: string | null) => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function refreshSession(): Promise<string | null> {
  refreshing ??= fetch(`${BASE}/api/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then(async (res) => {
      if (!res.ok) return null;
      const body = (await res.json()) as { accessToken: string };
      return body.accessToken;
    })
    .catch(() => null)
    .then((token) => {
      setToken(token);
      return token;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

type Options = Omit<RequestInit, 'body'> & { body?: unknown; query?: Record<string, string | number | boolean | undefined | null> };

export async function api<T>(path: string, opts: Options = {}, retry = true): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const headers = new Headers(opts.headers);
  if (opts.body !== undefined) headers.set('content-type', 'application/json');
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);

  const res = await fetch(url, {
    ...opts,
    headers,
    credentials: 'include',
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

  if (res.status === 401 && retry && !path.startsWith('/api/auth/')) {
    const token = await refreshSession();
    if (token) return api<T>(path, opts, false);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } }).error;
    throw new ApiError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return data as T;
}

/** Turns validation details into a readable sentence for toasts/forms. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const issues = (err.details as { issues?: { path: string; message: string }[] } | undefined)?.issues;
    if (issues?.length) return issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; ');
    return err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong';
}
