import { hashBody, signChallenge } from './device';

export type User = { id: string; name: string; phone: string; role: 'ADMIN' | 'TEACHER' | 'STUDENT'; must_change_password: boolean; totp_required?: boolean };
export type AuthStatus = { authenticated: boolean; user?: User; session_id?: string; session_active?: boolean; csrf_token?: string; device_status?: 'approved' | 'pending' | 'unregistered' | 'revoked' | 'different'; devices?: BrowserRequest[]; mfa_verified?: boolean };
export type BrowserRequest = { id: string; user_id: string; name?: string; phone?: string; user_name?: string; user_phone?: string; label: string; created_at: string; status?: string; fingerprint?: string; key_fingerprint?: string };
export type Lesson = { id: string; title: string; description: string; starts_at: string; course_title: string };
export type Course = { id: string; title: string; summary: string; price_kzt: number; weeks: number; lessons: number; hours: number; group_capacity: number };
export type PublicData = { courses: Course[]; settings: { whatsapp?: string | null; contact_email?: string | null } };
let csrfToken = '';
export function setCsrfToken(token?: string) { csrfToken = token ?? ''; }
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown; proof?: string; signal?: AbortSignal; binary?: boolean } = {}): Promise<T> {
  const method = options.method ?? 'GET';
  // All mutations carry JSON; challenge hashes the exact bytes subsequently sent.
  const body = options.body === undefined ? (method === 'GET' || method === 'HEAD' ? undefined : '{}') : JSON.stringify(options.body);
  const headers: Record<string, string> = { accept: options.binary ? '*/*' : 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (csrfToken && method !== 'GET') headers['x-csrf-token'] = csrfToken;
  if (options.proof) {
    const challenge = await api<{ id: string; payload: string | Record<string, unknown> }>('/api/proof/challenge', {
      method: 'POST', body: { method, path, purpose: options.proof, body_hash: await hashBody(body ?? '') }, signal: options.signal,
    });
    headers['x-proof-id'] = challenge.id;
    headers['x-device-proof'] = await signChallenge(challenge.payload);
  }
  const requestController = new AbortController();
  const abortFromCaller = () => requestController.abort();
  options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  if (options.signal?.aborted) requestController.abort();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; requestController.abort(); }, 30000);
  try {
    const response = await fetch(path, { method, headers, body, credentials: 'same-origin', cache: 'no-store', signal: requestController.signal });
    if (!response.ok) {
      let payload: { error?: string; message?: string; code?: string } = {};
      try { payload = await response.json(); } catch { /* Generic error deliberately contains no server diagnostics. */ }
      if (response.status === 401) window.dispatchEvent(new CustomEvent('uyym-session-expired'));
      throw new ApiError(payload.message ?? payload.error ?? 'Сұрауды орындау мүмкін болмады. Қайта көріңіз.', response.status, payload.code);
    }
    if (options.binary) return await response.arrayBuffer() as T;
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  } catch (error) {
    if (timedOut) throw new ApiError('Сұрау уақыты аяқталды. Интернет байланысын тексеріп, қайта көріңіз.', 408, 'REQUEST_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}
