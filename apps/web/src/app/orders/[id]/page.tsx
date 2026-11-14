import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PHYSICAL_STATUS_LABELS, formatNaira, formatOrderNumber, uuidSchema, type OrderDetail } from '@onwa/shared';
import { Alert } from '@/components/ui/Alert';
import { ActionButtons } from '@/components/orders/ActionButtons';
import { Items, StatusPill, Timeline } from '@/components/orders/OrderParts';
import { ApiError, apiRequest } from '@/lib/api';
import { resolveMessage } from '@/lib/messages';
import { requireSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Order' };
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string; f?: string; m?: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const { token } = await requireSession(`/orders/${id}`);
  const sp = await searchParams;
  const message = resolveMessage(sp.e ?? sp.m, sp.f);

  let order: OrderDetail;
  try {
    order = (await apiRequest<{ order: OrderDetail }>(`/orders/${id}`, { token })).order;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    return <div className="container page-medium stack"><Alert tone="error">We could not load this order. Try again in a moment.</Alert></div>;
  }
  const a = order.shippingAddress;

  return (
    <div className="container page-medium stack-lg">
      <div className="page-head">
        <h1>Order {formatOrderNumber(order.orderNumber)}</h1>
        <div className="row"><StatusPill status={order.status} /><span className="muted small">Placed {new Date(order.createdAt).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}</span></div>
        <p className="small"><Link href="/orders">All orders</Link></p>
      </div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {order.status === 'pending_payment' ? (
        <Alert tone="info">
          Your items are reserved{order.expiresAt ? ` until ${new Date(order.expiresAt).toLocaleTimeString('en-NG', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit' })}` : ''}. Online payment opens in an upcoming release; unpaid orders are cancelled automatically when the reservation ends and the items return to stock. You can also cancel now.
        </Alert>
      ) : null}

      {order.suborders.map((s) => (
        <section key={s.id} className="card stack" aria-labelledby={`so-${s.id}`}>
          <div className="item-head"><h2 id={`so-${s.id}`} style={{ fontSize: '1.5rem' }}><Link href={`/store/${s.store.slug}`}>{s.store.name}</Link></h2><StatusPill status={s.status} /></div>
          <Items items={s.items} />
          <ActionButtons suborderId={s.id} actions={s.actions} returnTo={`/orders/${order.id}`} />
          <details><summary className="small">Order history</summary><div style={{ marginTop: 'var(--space-3)' }}><Timeline history={s.history} /></div></details>
        </section>
      ))}

      <section className="card stack" aria-labelledby="totals-title">
        <h2 id="totals-title">Totals</h2>
        <dl className="kv">
          <div><dt>Subtotal</dt><dd>{formatNaira(order.subtotalKobo)}</dd></div>
          <div><dt>Delivery</dt><dd>{formatNaira(order.shippingKobo)}</dd></div>
          <div><dt>Total</dt><dd><strong>{formatNaira(order.totalKobo)}</strong></dd></div>
          <div><dt>Payment</dt><dd>{order.status === 'paid' ? 'Paid' : order.status === 'cancelled' ? 'Not charged' : 'Awaiting payment'}</dd></div>
        </dl>
      </section>

      <section className="card stack" aria-labelledby="addr-title">
        <h2 id="addr-title">Delivery address</h2>
        <p>{a.recipientName}, {a.phone}<br />{a.line1}{a.line2 ? `, ${a.line2}` : ''}<br />{a.city}, {a.lga}, {a.state}{a.postalCode ? ` ${a.postalCode}` : ''}{a.landmark ? <><br />Near {a.landmark}</> : null}</p>
        {order.note ? <p className="muted">Your note: {order.note}</p> : null}
        <p className="muted small">Status labels: {Object.values(PHYSICAL_STATUS_LABELS).slice(0, 8).join(' → ')}</p>
      </section>
    </div>
  );
}
