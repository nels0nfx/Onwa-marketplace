import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PRODUCT_STATUSES, PRODUCT_STATUS_LABELS, listProductsQuerySchema, type AdminProductRow, type Paged } from '@onwa/shared';
import { Alert } from '@/components/ui/Alert';
import { apiRequest } from '@/lib/api';
import { resolveMessage } from '@/lib/messages';
import { loadMe, requireSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Product moderation' };
export const maxDuration = 45;

export default async function AdminProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { token } = await requireSession('/admin/products');
  const { me, apiDown } = await loadMe(token);
  if (apiDown) return <div className="container page-wide"><Alert tone="error">The administration service is unavailable. Try again shortly.</Alert></div>;
  if (!me || !me.permissions.includes('catalog.moderate')) notFound();
  const message = resolveMessage(sp.e ?? sp.m, sp.f);
  const q = listProductsQuerySchema.safeParse({ status: sp.status || undefined, offset: sp.offset });
  const { status, limit, offset } = q.success ? q.data : { status: undefined, limit: 20, offset: 0 };
  const shown = status ?? 'pending_review';

  let data: Paged<AdminProductRow> | null = null;
  let failed = false;
  try {
    data = await apiRequest<Paged<AdminProductRow>>(`/admin/products?${new URLSearchParams({ status: shown, limit: String(limit), offset: String(offset) })}`, { token });
  } catch {
    failed = true;
  }
  const href = (s: string, o: number) => `/admin/products?${new URLSearchParams({ status: s, offset: String(Math.max(0, o)) })}`;

  return (
    <div className="container page-wide stack-lg">
      <div className="page-head"><h1>Product moderation</h1><p className="small"><Link href="/admin">Back to administration</Link></p></div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {failed ? <Alert tone="error">Some data could not be loaded. Try again.</Alert> : null}
      <div className="row" aria-label="Filter by status">
        {PRODUCT_STATUSES.map((s) => <Link key={s} className="nav-link" href={href(s, 0)} aria-current={shown === s ? 'page' : undefined}>{PRODUCT_STATUS_LABELS[s]}</Link>)}
      </div>
      {data && data.rows.length === 0 ? <p className="muted">Nothing here.</p> : null}
      <ul className="list-plain">
        {(data?.rows ?? []).map((p) => (
          <li key={p.id} className="item">
            <div className="item-head"><strong>{p.name}</strong><span className="status-pill" data-status={p.status === 'approved' ? 'approved' : p.status === 'rejected' ? 'rejected' : 'submitted'}>{PRODUCT_STATUS_LABELS[p.status]}</span></div>
            <span className="muted small">{p.storeName}{p.submittedAt ? ` · submitted ${new Date(p.submittedAt).toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos' })}` : ''}</span>
            <div><Link href={`/admin/products/${p.id}`}>Open listing</Link></div>
          </li>
        ))}
      </ul>
      {data ? (
        <div className="pager">
          {offset > 0 ? <Link href={href(shown, offset - limit)}>Previous</Link> : <span />}
          {offset + limit < data.total ? <Link href={href(shown, offset + limit)}>Next</Link> : <span />}
        </div>
      ) : null}
    </div>
  );
}
