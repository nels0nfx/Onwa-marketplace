import 'server-only';
import { redirect } from 'next/navigation';
import type { MeResponse } from '@onwa/shared';
import { apiRequest, ApiError } from '@/lib/api';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function getSessionToken(): Promise<{ userId: string; token: string } | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser(); // verified against Supabase Auth
  if (!user) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { userId: user.id, token: session.access_token } : null;
}

export async function requireSession(returnTo: string): Promise<{ userId: string; token: string }> {
  const session = await getSessionToken();
  if (!session) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  return session;
}

/** Loads profile, roles and permissions from the API. Returns null if the API says the session is invalid. */
export async function loadMe(token: string): Promise<{ me: MeResponse | null; apiDown: boolean }> {
  try {
    return { me: await apiRequest<MeResponse>('/me', { token }), apiDown: false };
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return { me: null, apiDown: false };
    return { me: null, apiDown: true };
  }
}
