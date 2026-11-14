import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ORDER_STATUSES, PHYSICAL_STATUS_LABELS, formatNaira, formatOrderNumber, type AdminOrderRow, type OrderStatus, type Paged } from '@onwa/shared';
import { Alert } from '@/components/ui/Alert';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { StatusPill } from '@/components/orders/OrderParts';
import { apiRequest } from '@/lib/api';
import { resolveMessage } from '@/lib/messages';
import { loadMe, requireSession } from '@/lib/session';
import { sweepExpiredAction } from './actions';

export const metadata: Metadata = { title: 'Orders' };
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; offset?: string; e?: string; m?: string }> }) {
  const { token } = await requireSession('/admin/orders');
  const sp = await searchParams;
  const { me, apiDown } = await loadMe(token);
  if (apiDown) return <div className="container page-wide"><Alert tone="error">The administration service is unavailable. Try again shortly.</Alert></div>;
  if (!me || !me.permissions.includes('orders.read')) notFound();
  const canManage = me.permissions.includes('orders.manage');
  const message = resolveMessage(sp.e ?? sp.m);
  const status = (ORDER_STATUSES as readonly string[]).includes(sp.status ?? '') ? (sp.status as OrderStatus) : undefined;
  const offset = Math.max(0, Number.parseInt(sp.offset ?? '0', 10) || 0);
  const limit = 20;

  let data: Paged<AdminOrderRow> | null = null;
  try {
    data = await apiRequest<Paged<AdminOrderRow>>(`/admin/orders?${new URLSearchParams({ limit: String(limit), offset: String(offset), ...(status ? { status } : {}) })}`, { token });
  } catch {
    data = null;
  }
  const href = (s: string | undefined, o: number) => `/admin/orders?${new URLSearchParams({ ...(s ? { status: s } : {}), offset: String(Math.max(0, o)) })}`;

  return (
    <div className="container page-wide stack-lg">
      <div className="page-head"><h1>Orders</h1><p className="small"><Link href="/admin">Back to administration</Link></p></div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {!data ? <Alert tone="error">Orders could not be loaded. Try again.</Alert> : null}
      {canManage ? (
        <form action={sweepExpiredAction} className="card stack">
          <p className="muted">Unpaid orders are cancelled automatically when someone checks out or views orders. Use this to run the clean-up now.</p>
          <div><SubmitButton variant="secondary" size="sm" pendingText="Running">Cancel expired unpaid orders</SubmitButton></div>
        </form>
      ) : null}
      <div className="row" aria-label="Filter by status">
        <Link className="nav-link" href="/admin/orders" aria-current={!status ? 'page' : undefined}>All</Link>
        {ORDER_STATUSES.map((s) => <Link key={s} className="nav-link" href={href(s, 0)} aria-current={status === s ? 'page' : undefined}>{PHYSICAL_STATUS_LABELS[s]}</Link>)}
      </div>
      {data && data.rows.length === 0 ? <p className="muted">No orders match.</p> : null}
      <ul className="list-plain">
        {(data?.rows ?? []).map((o) => (
          <li key={o.id} className="item">
            <div className="item-head"><strong>{formatOrderNumber(o.orderNumber)}</strong><StatusPill status={o.status} /></div>
            <span className="muted small">{o.buyerEmail} · {formatNaira(o.totalKobo)} · {new Date(o.createdAt).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}</span>
            <div><Link href={`/admin/orders/${o.id}`}>Open order</Link></div>
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
