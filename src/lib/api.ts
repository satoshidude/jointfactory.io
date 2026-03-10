const BASE = '/api';

export async function apiFetch(path: string, opts: RequestInit = {}) {
  const token = JSON.parse(localStorage.getItem('jf_auth') || '{}').token;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  const text = await res.text();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { return { error: 'Invalid response' }; }
}
