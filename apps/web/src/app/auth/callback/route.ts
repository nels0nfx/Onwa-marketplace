import { NextResponse, type NextRequest } from 'next/server';
import { safeRedirectPath } from '@onwa/shared';
import { siteUrl } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/** Completes email-confirmation and password-recovery links. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const next = safeRedirectPath(request.nextUrl.searchParams.get('next'));
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, siteUrl()));
  }
  return NextResponse.redirect(new URL('/login?e=callback_failed', siteUrl()));
}
