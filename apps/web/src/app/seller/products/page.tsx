import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PRODUCT_STATUSES, PRODUCT_STATUS_LABELS, formatNaira, listProductsQuerySchema, type Paged, type SellerProductRow } from '@onwa/shared';
import { Alert } from '@/components/ui/Alert';
import { ButtonLink } from '@/components/ui/Button';
import { ApiError, apiRequest } from '@/lib/api';
import { resolveMessage } from '@/lib/messages';
import { requireSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Your products' };
export const maxDuration = 45;

export default async function SellerProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { token } = await requireSession('/seller/products');
  const sp = await searchParams;
  const message = resolveMessage(sp.e ?? sp.m, sp.f);
  const q = listProductsQuerySchema.safeParse({ status: sp.status || undefined, offset: sp.offset });
  const { status, limit, offset } = q.success ? q.data : { status: undefined, limit: 20, offset: 0 };

  let data: Paged<SellerProductRow> | null = null;
  let failed = false;
  try {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset), ...(status ? { status } : {}) });
    data = await apiRequest<Paged<SellerProductRow>>(`/seller/products?${params}`, { token });
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) redirect('/sell');
    failed = true;
  }
  const href = (s: string | undefined, o: number) => `/seller/products?${new URLSearchParams({ ...(s ? { status: s } : {}), offset: String(Math.max(0, o)) })}`;

  return (
    <div className="container page-wide stack-lg">
      <div className="page-head">
        <h1>Your products</h1>
        <div className="row"><ButtonLink href="/seller/products/new">New product</ButtonLink><Link href="/seller">Back to dashboard</Link></div>
      </div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {failed ? <Alert tone="error">We could not load your products. Try again in a moment.</Alert> : null}
      <div className="row" aria-label="Filter by status">
        <Link className="nav-link" href="/seller/products" aria-current={!status ? 'page' : undefined}>All</Link>
        {PRODUCT_STATUSES.map((s) => <Link key={s} className="nav-link" href={href(s, 0)} aria-current={status === s ? 'page' : undefined}>{PRODUCT_STATUS_LABELS[s]}</Link>)}
      </div>
      {data && data.rows.length === 0 ? <p className="muted">No products here yet. Create one to get started.</p> : null}
      <ul className="list-plain">
        {(data?.rows ?? []).map((p) => (
          <li key={p.id} className="item">
            <div className="row">
              {p.imageUrl ? <img className="logo-sm" src={p.imageUrl} alt="" /> : <span className="logo-sm" aria-hidden="true">{p.name.slice(0, 1)}</span>}
              <div className="stack" style={{ gap: 'var(--space-1)' }}>
                <strong>{p.name}</strong>
                <span className="muted small">{p.priceFromKobo !== null ? `From ${formatNaira(p.priceFromKobo)}` : 'No price'} · {p.totalStock} in stock</span>
              </div>
              <span className="status-pill" data-status={p.status === 'approved' ? 'approved' : p.status === 'rejected' ? 'rejected' : p.status === 'draft' || p.status === 'archived' ? 'draft' : 'submitted'}>{PRODUCT_STATUS_LABELS[p.status]}</span>
            </div>
            <div><Link href={`/seller/products/${p.id}`}>Manage</Link></div>
          </li>
        ))}
      </ul>
      {data ? (
        <div className="pager">
          {offset > 0 ? <Link href={href(status, offset - limit)}>Previous</Link> : <span />}
          {offset + limit < data.total ? <Link href={href(status, offset + limit)}>Next</Link> : <span />}
        </div>
      ) : null}
    </div>
  );
}
