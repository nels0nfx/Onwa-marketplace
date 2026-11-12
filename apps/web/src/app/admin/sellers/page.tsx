import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  APPLICATION_STATUSES, STATUS_LABELS, listApplicationsQuerySchema,
  type AdminApplicationRow, type AdminSellerRow, type ApplicationStatus, type Paged,
} from '@onwa/shared';
import { Alert } from '@/components/ui/Alert';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { apiRequest } from '@/lib/api';
import { resolveMessage } from '@/lib/messages';
import { loadMe, requireSession } from '@/lib/session';
import { setSellerStatusAction } from './actions';

export const metadata: Metadata = { title: 'Sellers' };
export const maxDuration = 45;

export default async function AdminSellersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { token } = await requireSession('/admin/sellers');
  const { me, apiDown } = await loadMe(token);
  if (apiDown) return <div className="container page-wide"><Alert tone="error">The administration service is unavailable. Try again shortly.</Alert></div>;
  if (!me || !me.permissions.includes('sellers.read')) notFound();
  const canManage = me.permissions.includes('sellers.manage');
  const message = resolveMessage(sp.e ?? sp.m, sp.f);

  const q = listApplicationsQuerySchema.safeParse({ status: sp.status || undefined, offset: sp.offset });
  const { status, limit, offset } = q.success ? q.data : { status: undefined as ApplicationStatus | undefined, limit: 20, offset: 0 };

  let apps: Paged<AdminApplicationRow> | null = null;
  let sellers: Paged<AdminSellerRow> | null = null;
  let failed = false;
  try {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset), ...(status ? { status } : {}) });
    apps = await apiRequest<Paged<AdminApplicationRow>>(`/admin/seller-applications?${params}`, { token });
    sellers = await apiRequest<Paged<AdminSellerRow>>('/admin/sellers?limit=50', { token });
  } catch {
    failed = true;
  }
  const href = (s: string | undefined, o: number) => `/admin/sellers?${new URLSearchParams({ ...(s ? { status: s } : {}), offset: String(Math.max(0, o)) })}`;

  return (
    <div className="container page-wide stack-lg">
      <div className="page-head"><h1>Sellers</h1><p className="small"><Link href="/admin">Back to administration</Link></p></div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {failed ? <Alert tone="error">Some data could not be loaded. Try again.</Alert> : null}

      <section className="stack" aria-labelledby="apps-title">
        <h2 id="apps-title">Applications</h2>
        <div className="row" aria-label="Filter by status">
          <Link className="nav-link" href="/admin/sellers" aria-current={!status ? 'page' : undefined}>All (not drafts)</Link>
          {APPLICATION_STATUSES.map((s) => (
            <Link key={s} className="nav-link" href={href(s, 0)} aria-current={status === s ? 'page' : undefined}>{STATUS_LABELS[s]}</Link>
          ))}
        </div>
        {apps && apps.rows.length === 0 ? <p className="muted">No applications match this filter.</p> : null}
        <ul className="list-plain">
          {(apps?.rows ?? []).map((a) => (
            <li key={a.id} className="item">
              <div className="item-head">
                <strong>{a.businessName || a.legalName || 'Unnamed application'}</strong>
                <span className="status-pill" data-status={a.status}>{STATUS_LABELS[a.status]}</span>
              </div>
              <span className="muted small">{a.applicantEmail}{a.submittedAt ? ` · submitted ${new Date(a.submittedAt).toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos' })}` : ''}</span>
              <div><Link href={`/admin/sellers/${a.id}`}>Open application</Link></div>
            </li>
          ))}
        </ul>
        {apps ? (
          <div className="pager">
            {offset > 0 ? <Link href={href(status, offset - limit)}>Previous</Link> : <span />}
            {offset + limit < apps.total ? <Link href={href(status, offset + limit)}>Next</Link> : <span />}
          </div>
        ) : null}
      </section>

      <section className="stack" aria-labelledby="sellers-title">
        <h2 id="sellers-title">Approved sellers</h2>
        {sellers && sellers.rows.length === 0 ? <p className="muted">No sellers yet.</p> : null}
        <ul className="list-plain">
          {(sellers?.rows ?? []).map((s) => (
            <li key={s.id} className="item">
              <div className="item-head"><strong>{s.storeName}</strong><span className="status-pill" data-status={s.status}>{s.status === 'active' ? 'Active' : 'Suspended'}</span></div>
              <span className="muted small">{s.applicantEmail} · <Link href={`/store/${s.storeSlug}`}>/store/{s.storeSlug}</Link></span>
              {canManage ? (
                <form action={setSellerStatusAction} className="stack">
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="status" value={s.status === 'active' ? 'suspended' : 'active'} />
                  {s.status === 'active' ? (
                    <div className="field"><label htmlFor={`note-${s.id}`}>Reason for suspension</label><input id={`note-${s.id}`} name="note" className="input" minLength={5} maxLength={1000} required /></div>
                  ) : null}
                  <div><SubmitButton size="sm" variant={s.status === 'active' ? 'danger' : 'secondary'} pendingText="Saving">{s.status === 'active' ? 'Suspend seller' : 'Reinstate seller'}</SubmitButton></div>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
