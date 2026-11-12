import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

async function probe(url: string, init?: RequestInit) {
  const t = Date.now();
  try {
    const res = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(20000) });
    return `HTTP ${res.status} in ${Date.now() - t}ms`;
  } catch (e) {
    return `FAILED after ${Date.now() - t}ms (${e instanceof Error ? e.name : 'error'})`;
  }
}

export default async function StatusPage() {
  const base = process.env.API_BASE_URL?.replace(/\/+$/, '');
  const rows: [string, string][] = [
    ['Supabase URL set', process.env.NEXT_PUBLIC_SUPABASE_URL ? 'yes' : 'NO'],
    ['Supabase anon key set', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'yes' : 'NO'],
    ['Site URL', process.env.NEXT_PUBLIC_SITE_URL ?? 'NOT SET'],
    ['API base URL', base ?? 'NOT SET'],
  ];
  if (base) rows.push(['API health', await probe(`${base}/api/v1/health`)]);
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  rows.push(['Signed in', user ? 'yes' : `no${error ? ` (${error.message})` : ''}`]);
  const { data: { session } } = await supabase.auth.getSession();
  rows.push(['Access token present', session?.access_token ? 'yes' : 'no']);
  if (base && session?.access_token) {
    rows.push(['API /me with your login', await probe(`${base}/api/v1/me`, { headers: { authorization: `Bearer ${session.access_token}` } })]);
  }
  return (
    <div className="container page-medium stack">
      <h1>Status</h1>
      <ul className="audit-list">
        {rows.map(([k, v]) => (<li key={k}><strong>{k}</strong><span className="muted" style={{ overflowWrap: 'anywhere' }}>{v}</span></li>))}
      </ul>
    </div>
  );
}
