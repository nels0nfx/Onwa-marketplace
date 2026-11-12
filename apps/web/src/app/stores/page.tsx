import type { Metadata } from 'next';
import Link from 'next/link';
import { listStoresQuerySchema, type Paged, type PublicStoreCard } from '@onwa/shared';
import { Alert } from '@/components/ui/Alert';
import { apiPublic } from '@/lib/api';

export const metadata: Metadata = { title: 'Stores' };
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

export default async function StoresPage({ searchParams }: { searchParams: Promise<{ q?: string; offset?: string }> }) {
  const sp = await searchParams;
  const parsed = listStoresQuerySchema.safeParse({ q: sp.q, offset: sp.offset });
  const { q, limit, offset } = parsed.success ? parsed.data : { q: undefined, limit: 24, offset: 0 };

  let data: Paged<PublicStoreCard> | null = null;
  let failed = false;
  try {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset), ...(q ? { q } : {}) });
    data = await apiPublic<Paged<PublicStoreCard>>(`/stores?${params}`);
  } catch {
    failed = true;
  }
  const href = (o: number) => `/stores?${new URLSearchParams({ ...(q ? { q } : {}), offset: String(Math.max(0, o)) })}`;

  return (
    <div className="container page-wide stack-lg">
      <div className="page-head">
        <h1>Stores</h1>
        <p className="muted">Independent sellers on ONWA.</p>
      </div>
      <form method="get" className="row" role="search">
        <label className="visually-hidden" htmlFor="q">Search stores</label>
        <input id="q" name="q" className="input" style={{ maxWidth: '22rem' }} defaultValue={q ?? ''} placeholder="Search stores" maxLength={64} />
        <button className="btn btn-secondary" type="submit">Search</button>
      </form>
      {failed ? <Alert tone="error">We could not load stores right now. Try again in a moment.</Alert> : null}
      {data && data.rows.length === 0 ? <p className="muted">{q ? 'No stores match that search.' : 'No stores have opened yet. Check back soon.'}</p> : null}
      {data && data.rows.length > 0 ? (
        <div className="cards">
          {data.rows.map((s) => (
            <Link key={s.slug} href={`/store/${s.slug}`} className="store-card" data-accent={s.accent}>
              {s.logoUrl ? <img className="logo-sm" src={s.logoUrl} alt="" /> : <span className="logo-sm" aria-hidden="true">{s.name.slice(0, 1)}</span>}
              <h3>{s.name}</h3>
              {s.tagline ? <p className="muted">{s.tagline}</p> : null}
            </Link>
          ))}
        </div>
      ) : null}
      {data ? (
        <div className="pager">
          {offset > 0 ? <Link href={href(offset - limit)}>Previous</Link> : <span />}
          {offset + limit < data.total ? <Link href={href(offset + limit)}>Next</Link> : <span />}
        </div>
      ) : null}
    </div>
  );
}
