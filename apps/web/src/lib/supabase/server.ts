import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabasePublicConfig } from '@/lib/env';

/** Server-side Supabase client bound to the visitor's session cookies. Uses the public anon key only. */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = supabasePublicConfig();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are refreshed by middleware instead.
        }
      },
    },
  });
}
