import 'server-only';

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Server-to-server call to the ONWA API. The Supabase access token is forwarded; the API re-verifies it. */
export async function apiRequest<T>(
  path: string,
  options: { token: string; method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown },
): Promise<T> {
  const base = process.env.API_BASE_URL;
  if (!base) throw new ApiError(500, 'misconfigured', 'API_BASE_URL is not set');

  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/+$/, '')}/api/v1${path}`, {
      method: options.method ?? 'GET',
      headers: {
        authorization: `Bearer ${options.token}`,
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    throw new ApiError(503, 'unreachable', 'The ONWA API could not be reached');
  }

  if (res.status === 204) return undefined as T;
  const payload = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  if (!res.ok) throw new ApiError(res.status, payload?.error?.code ?? 'error', payload?.error?.message ?? 'Request failed');
  return payload as T;
}

/** Unauthenticated read of a public API endpoint (storefronts). Returns null on 404. */
export async function apiPublic<T>(path: string): Promise<T | null> {
  const base = process.env.API_BASE_URL;
  if (!base) throw new ApiError(500, 'misconfigured', 'API_BASE_URL is not set');
  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/+$/, '')}/api/v1${path}`, { cache: 'no-store', signal: AbortSignal.timeout(25000) });
  } catch {
    throw new ApiError(503, 'unreachable', 'The ONWA API could not be reached');
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(res.status, 'error', 'Request failed');
  return (await res.json()) as T;
}
