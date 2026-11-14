import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatNaira, formatOrderNumber, uuidSchema, type OrderDetail } from '@onwa/shared';
import { Alert } from '@/components/ui/Alert';
import { ActionButtons } from '@/components/orders/ActionButtons';
import { Items, StatusPill, Timeline } from '@/components/orders/OrderParts';
import { ApiError, apiRequest } from '@/lib/api';
import { resolveMessage } from '@/lib/messages';
import { loadMe, requireSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Order' };
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

export default async function AdminOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string; f?: string; m?: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const { token } = await requireSession(`/admin/orders/${id}`);
  const sp = await searchParams;
  const { me, apiDown } = await loadMe(token);
  if (apiDown) return <div className="container page-wide"><Alert tone="error">The administration service is unavailable. Try again shortly.</Alert></div>;
  if (!me || !me.permissions.includes('orders.read')) notFound();
  const canManage = me.permissions.includes('orders.manage');
  const message = resolveMessage(sp.e ?? sp.m, sp.f);

  let order: OrderDetail;
  try {
    order = (await apiRequest<{ order: OrderDetail }>(`/admin/orders/${id}`, { token })).order;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    return <div className="container page-wide"><Alert tone="error">We could not load this order. Try again.</Alert></div>;
  }
  const a = order.shippingAddress;

  return (
    <div className="container page-wide stack-lg">
      <div className="page-head"><h1>Order {formatOrderNumber(order.orderNumber)}</h1><div className="row"><StatusPill status={order.status} /></div><p className="small"><Link href="/admin/orders">All orders</Link></p></div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {order.suborders.map((s) => (
        <section key={s.id} className="card stack" aria-labelledby={`so-${s.id}`}>
          <div className="item-head"><h2 id={`so-${s.id}`} style={{ fontSize: '1.5rem' }}>{s.store.name}</h2><StatusPill status={s.status} /></div>
          <Items items={s.items} />
          {canManage ? <ActionButtons suborderId={s.id} actions={s.actions} returnTo={`/admin/orders/${order.id}`} /> : null}
          <details><summary className="small">History</summary><div style={{ marginTop: 'var(--space-3)' }}><Timeline history={s.history} /></div></details>
        </section>
      ))}
      <section className="card stack"><h2>Totals</h2>
        <dl className="kv"><div><dt>Subtotal</dt><dd>{formatNaira(order.subtotalKobo)}</dd></div><div><dt>Delivery</dt><dd>{formatNaira(order.shippingKobo)}</dd></div><div><dt>Total</dt><dd><strong>{formatNaira(order.totalKobo)}</strong></dd></div></dl></section>
      <section className="card stack"><h2>Delivery address</h2>
        <p>{a.recipientName}, {a.phone}<br />{a.line1}{a.line2 ? `, ${a.line2}` : ''}, {a.city}, {a.lga}, {a.state}</p></section>
    </div>
  );
}
