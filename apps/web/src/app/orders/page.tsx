import type { Metadata } from 'next';
import Link from 'next/link';
import { formatNaira, formatOrderNumber, type OrderSummary, type Paged } from '@onwa/shared';
import { Alert } from '@/components/ui/Alert';
import { ButtonLink } from '@/components/ui/Button';
import { StatusPill } from '@/components/orders/OrderParts';
import { apiRequest } from '@/lib/api';
import { resolveMessage } from '@/lib/messages';
import { requireSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Your orders' };
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ offset?: string; e?: string; m?: string }> }) {
  const { token } = await requireSession('/orders');
  const sp = await searchParams;
  const message = resolveMessage(sp.e ?? sp.m);
  const offset = Math.max(0, Number.parseInt(sp.offset ?? '0', 10) || 0);
  const limit = 20;
  let data: Paged<OrderSummary> | null = null;
  try {
    data = await apiRequest<Paged<OrderSummary>>(`/orders?limit=${limit}&offset=${offset}`, { token });
  } catch {
    data = null;
  }
  return (
    <div className="container page-medium stack-lg">
      <div className="page-head"><h1>Your orders</h1></div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {!data ? <Alert tone="error">We could not load your orders. Try again in a moment.</Alert> : null}
      {data && data.rows.length === 0 ? <div className="stack"><p className="muted">You have not placed any orders yet.</p><div><ButtonLink href="/products">Browse products</ButtonLink></div></div> : null}
      <ul className="list-plain">
        {(data?.rows ?? []).map((o) => (
          <li key={o.id} className="item">
            <div className="item-head"><strong>{formatOrderNumber(o.orderNumber)}</strong><StatusPill status={o.status} /></div>
            <span className="muted small">{o.storeNames.join(', ')} · {o.itemCount} {o.itemCount === 1 ? 'item' : 'items'} · {new Date(o.createdAt).toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos' })}</span>
            <div className="item-head"><strong>{formatNaira(o.totalKobo)}</strong><Link href={`/orders/${o.id}`}>View order</Link></div>
          </li>
        ))}
      </ul>
      {data ? (
        <div className="pager">
          {offset > 0 ? <Link href={`/orders?offset=${Math.max(0, offset - limit)}`}>Previous</Link> : <span />}
          {offset + limit < data.total ? <Link href={`/orders?offset=${offset + limit}`}>Next</Link> : <span />}
        </div>
      ) : null}
    </div>
  );
}
