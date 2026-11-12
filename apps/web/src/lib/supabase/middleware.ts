import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { supabasePublicConfig } from '@/lib/env';

type CookieToSet = { name: string; value: string; options?: CookieOptions };
const PROTECTED_PREFIXES = ['/account', '/admin', '/reset-password', '/seller', '/sell/apply'];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, anonKey } = supabasePublicConfig();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list: CookieToSet[]) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  const { pathname, search } = request.nextUrl;

  if (!user && PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const to = request.nextUrl.clone();
    to.pathname = '/login';
    to.search = `?next=${encodeURIComponent(pathname + search)}`;
    const redirect = NextResponse.redirect(to);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }
  return response;
}
