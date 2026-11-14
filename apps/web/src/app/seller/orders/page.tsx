import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PHYSICAL_STATUSES, PHYSICAL_STATUS_LABELS, formatNaira, formatOrderNumber, type Paged, type PhysicalStatus, type SellerOrderRow } from '@onwa/shared';
import { Alert } from '@/components/ui/Alert';
import { StatusPill } from '@/components/orders/OrderParts';
import { ApiError, apiRequest } from '@/lib/api';
import { resolveMessage } from '@/lib/messages';
import { requireSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Orders' };
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

export default async function SellerOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; offset?: string; e?: string; m?: string }> }) {
  const { token } = await requireSession('/seller/orders');
  const sp = await searchParams;
  const message = resolveMessage(sp.e ?? sp.m);
  const status = (PHYSICAL_STATUSES as readonly string[]).includes(sp.status ?? '') ? (sp.status as PhysicalStatus) : undefined;
  const offset = Math.max(0, Number.parseInt(sp.offset ?? '0', 10) || 0);
  const limit = 20;
  let data: Paged<SellerOrderRow> | null = null;
  try {
    data = await apiRequest<Paged<SellerOrderRow>>(`/seller/orders?${new URLSearchParams({ limit: String(limit), offset: String(offset), ...(status ? { status } : {}) })}`, { token });
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) redirect('/sell');
    data = null;
  }
  const href = (s: string | undefined, o: number) => `/seller/orders?${new URLSearchParams({ ...(s ? { status: s } : {}), offset: String(Math.max(0, o)) })}`;
  const chips: PhysicalStatus[] = ['paid', 'processing', 'ready_for_dispatch', 'dispatched', 'in_transit', 'delivered', 'completed', 'return_requested'];

  return (
    <div className="container page-wide stack-lg">
      <div className="page-head"><h1>Orders</h1><p className="muted">Orders appear here once the customer has paid. Unpaid orders are never shown to sellers.</p><p className="small"><Link href="/seller">Back to dashboard</Link></p></div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {!data ? <Alert tone="error">We could not load orders. Try again in a moment.</Alert> : null}
      <div className="row" aria-label="Filter by status">
        <Link className="nav-link" href="/seller/orders" aria-current={!status ? 'page' : undefined}>All</Link>
        {chips.map((s) => <Link key={s} className="nav-link" href={href(s, 0)} aria-current={status === s ? 'page' : undefined}>{PHYSICAL_STATUS_LABELS[s]}</Link>)}
      </div>
      {data && data.rows.length === 0 ? <p className="muted">No orders here yet.</p> : null}
      <ul className="list-plain">
        {(data?.rows ?? []).map((o) => (
          <li key={o.id} className="item">
            <div className="item-head"><strong>{formatOrderNumber(o.orderNumber)}</strong><StatusPill status={o.status} /></div>
            <span className="muted small">{o.itemCount} {o.itemCount === 1 ? 'item' : 'items'} · {formatNaira(o.totalKobo)} · {new Date(o.createdAt).toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos' })}</span>
            <div><Link href={`/seller/orders/${o.id}`}>Open order</Link></div>
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
