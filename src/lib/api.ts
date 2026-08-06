import { SESSION_ID, SESSION_HEADER } from './session';

const BASE = '/api';

export async function apiFetch(path: string, opts: RequestInit = {}) {
  const token = JSON.parse(localStorage.getItem('jf_auth') || '{}').token;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // Which tab is asking. The server only lets the newest one write. See session.ts.
    [SESSION_HEADER]: SESSION_ID,
    ...(opts.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  const text = await res.text();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { return { error: 'Invalid response' }; }
}

/**
 * WebSocket endpoint for live lottery and player updates.
 *
 * Six components each carried `location.hostname === 'localhost' ? 'localhost:3420'
 * : location.host`, but the API server listens on 3421 — so live updates never
 * arrived in local development. The dev server proxies /ws to the API, so the
 * page host is right in both environments.
 */
export function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}
