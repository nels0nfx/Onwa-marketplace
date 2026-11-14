import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatNaira, formatOrderNumber, uuidSchema, type SellerOrderDetail } from '@onwa/shared';
import { Alert } from '@/components/ui/Alert';
import { ActionButtons } from '@/components/orders/ActionButtons';
import { Items, StatusPill, Timeline } from '@/components/orders/OrderParts';
import { ApiError, apiRequest } from '@/lib/api';
import { resolveMessage } from '@/lib/messages';
import { requireSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Order' };
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

export default async function SellerOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string; f?: string; m?: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const { token } = await requireSession(`/seller/orders/${id}`);
  const sp = await searchParams;
  const message = resolveMessage(sp.e ?? sp.m, sp.f);

  let order: SellerOrderDetail;
  try {
    order = (await apiRequest<{ order: SellerOrderDetail }>(`/seller/orders/${id}`, { token })).order;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    return <div className="container page-medium stack"><Alert tone="error">We could not load this order. Try again in a moment.</Alert></div>;
  }
  const a = order.shippingAddress;

  return (
    <div className="container page-medium stack-lg">
      <div className="page-head">
        <h1>Order {formatOrderNumber(order.orderNumber)}</h1>
        <div className="row"><StatusPill status={order.status} /></div>
        <p className="small"><Link href="/seller/orders">All orders</Link></p>
      </div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}

      <section className="card stack" aria-labelledby="next-title">
        <h2 id="next-title">Next step</h2>
        {order.actions.length > 0 ? <ActionButtons suborderId={order.id} actions={order.actions} returnTo={`/seller/orders/${order.id}`} /> : <p className="muted">Nothing for you to do right now.</p>}
      </section>

      <section className="card stack" aria-labelledby="items-title"><h2 id="items-title">Items</h2><Items items={order.items} />
        <dl className="kv"><div><dt>Subtotal</dt><dd>{formatNaira(order.subtotalKobo)}</dd></div><div><dt>Delivery</dt><dd>{formatNaira(order.shippingKobo)}</dd></div><div><dt>Total</dt><dd><strong>{formatNaira(order.totalKobo)}</strong></dd></div></dl></section>

      {a && order.buyer ? (
        <section className="card stack" aria-labelledby="ship-title"><h2 id="ship-title">Deliver to</h2>
          <p>{order.buyer.name}, {order.buyer.phone}<br />{a.line1}{a.line2 ? `, ${a.line2}` : ''}<br />{a.city}, {a.lga}, {a.state}{a.postalCode ? ` ${a.postalCode}` : ''}{a.landmark ? <><br />Near {a.landmark}</> : null}</p>
          {order.note ? <p className="muted">Customer note: {order.note}</p> : null}
        </section>
      ) : null}

      <section className="stack" aria-labelledby="hist-title"><h2 id="hist-title">History</h2><Timeline history={order.history} /></section>
    </div>
  );
}
