import 'server-only';
import { redirect } from 'next/navigation';
import type { MeResponse } from '@onwa/shared';
import { apiRequest, ApiError } from '@/lib/api';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function getSessionToken(): Promise<{ userId: string; token: string } | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { userId: user.id, token: session.access_token } : null;
}

export async function requireSession(returnTo: string): Promise<{ userId: string; token: string }> {
  const session = await getSessionToken();
  if (!session) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  return session;
}

export async function loadMe(token: string): Promise<{ me: MeResponse | null; apiDown: boolean; status: number }> {
  try {
    return { me: await apiRequest<MeResponse>('/me', { token }), apiDown: false, status: 200 };
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return { me: null, apiDown: false, status: e.status };
    return { me: null, apiDown: true, status: e instanceof ApiError ? e.status : 0 };
  }
}
