import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { supabasePublicConfig } from '@/lib/env';

const PROTECTED_PREFIXES = ['/account', '/admin', '/reset-password'];
const GUEST_ONLY = ['/login', '/register', '/forgot-password'];

/**
 * Refreshes the Supabase session cookie and gates routes that need a signed-in user.
 * This is a convenience redirect only: every protected page and every API call re-checks
 * the session and permissions on the server.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, anonKey } = supabasePublicConfig();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  const { pathname, search } = request.nextUrl;

  const redirectWithCookies = (to: URL) => {
    const redirect = NextResponse.redirect(to);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  };

  if (!user && PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const to = request.nextUrl.clone();
    to.pathname = '/login';
    to.search = `?next=${encodeURIComponent(pathname + search)}`;
    return redirectWithCookies(to);
  }

  if (user && GUEST_ONLY.includes(pathname)) {
    const to = request.nextUrl.clone();
    to.pathname = '/account';
    to.search = '';
    return redirectWithCookies(to);
  }

  return response;
}
