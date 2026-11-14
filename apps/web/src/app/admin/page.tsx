import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ROLE_CODES, ROLE_DEFINITIONS, listAuditQuerySchema, listUsersQuerySchema,
  type AdminUserRow, type AuditLogRow, type Paged,
} from '@onwa/shared';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { apiRequest } from '@/lib/api';
import { resolveMessage } from '@/lib/messages';
import { loadMe, requireSession } from '@/lib/session';
import { assignRoleAction, revokeRoleAction } from './actions';

export const metadata: Metadata = { title: 'Administration' };

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { token } = await requireSession('/admin');
  const { me, apiDown } = await loadMe(token);
  if (apiDown) {
    return <div className="container page-wide"><Alert tone="error">The administration service is unavailable. Try again shortly.</Alert></div>;
  }
  // Server-side authorization: the navigation link being hidden is not what protects this page.
  if (!me || !me.permissions.includes('admin.access')) notFound();

  const can = (p: (typeof me.permissions)[number]) => me.permissions.includes(p);
  const query = listUsersQuerySchema.safeParse({ q: sp.q, offset: sp.offset });
  const { q, limit, offset } = query.success ? query.data : { q: undefined, limit: 20, offset: 0 };
  const message = resolveMessage(sp.e ?? sp.m);

  let users: Paged<AdminUserRow> | null = null;
  let audit: Paged<AuditLogRow> | null = null;
  let loadFailed = false;
  try {
    if (can('customers.read')) {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset), ...(q ? { q } : {}) });
      users = await apiRequest<Paged<AdminUserRow>>(`/admin/users?${params}`, { token });
    }
    if (can('audit.read')) {
      const a = listAuditQuerySchema.parse({ limit: 15 });
      audit = await apiRequest<Paged<AuditLogRow>>(`/admin/audit-logs?limit=${a.limit}`, { token });
    }
  } catch {
    loadFailed = true;
  }

  const returnTo = `/admin?${new URLSearchParams({ ...(q ? { q } : {}), ...(offset ? { offset: String(offset) } : {}) })}`;
  const pageHref = (o: number) => `/admin?${new URLSearchParams({ ...(q ? { q } : {}), offset: String(Math.max(0, o)) })}`;

  return (
    <div className="container page-wide stack-lg">
      <div className="page-head">
        <h1>Administration</h1>
        <div className="row">{me.roles.map((r) => <Badge key={r} staff={ROLE_DEFINITIONS[r].isStaff}>{ROLE_DEFINITIONS[r].name}</Badge>)}</div>
        <p className="muted">Modules for sellers, catalogue, orders and finance are added in later releases. This release covers accounts, roles, seller applications, product moderation, categories, orders and the audit log.</p>
      </div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {can('sellers.read') ? (
        <section className="card stack" aria-labelledby="sellers-card-title">
          <h2 id="sellers-card-title">Sellers</h2>
          <p className="muted">Review seller applications and manage approved sellers.</p>
          <div><Link className="btn btn-secondary" href="/admin/sellers">Open seller applications</Link></div>
        </section>
      ) : null}
      {can('catalog.moderate') ? (
        <section className="card stack" aria-labelledby="products-card-title">
          <h2 id="products-card-title">Product listings</h2>
          <p className="muted">Review listings submitted by sellers before they go live.</p>
          <div><Link className="btn btn-secondary" href="/admin/products">Open moderation queue</Link></div>
        </section>
      ) : null}
      {can('orders.read') ? (
        <section className="card stack" aria-labelledby="orders-card-title">
          <h2 id="orders-card-title">Orders</h2>
          <p className="muted">See every order, cancel unpaid ones and clean up expired reservations.</p>
          <div><Link className="btn btn-secondary" href="/admin/orders">Open orders</Link></div>
        </section>
      ) : null}
      {can('categories.manage') ? (
        <section className="card stack" aria-labelledby="cats-card-title">
          <h2 id="cats-card-title">Categories</h2>
          <p className="muted">Create, rename, reorder or hide product categories.</p>
          <div><Link className="btn btn-secondary" href="/admin/categories">Manage categories</Link></div>
        </section>
      ) : null}
      {loadFailed ? <Alert tone="error">Some data could not be loaded. Try again.</Alert> : null}

      {users ? (
        <section className="stack" aria-labelledby="users-title">
          <h2 id="users-title">Accounts</h2>
          <form method="get" className="row" role="search">
            <label className="visually-hidden" htmlFor="q">Search by name or email</label>
            <input id="q" name="q" className="input" style={{ maxWidth: '22rem' }} defaultValue={q ?? ''} placeholder="Search name or email" maxLength={64} />
            <button className="btn btn-secondary" type="submit">Search</button>
          </form>
          {users.rows.length === 0 ? <p className="muted">No accounts match that search.</p> : (
            <ul className="user-list">
              {users.rows.map((u) => (
                <li key={u.id} className="user-item">
                  <div className="user-id"><strong>{u.fullName || 'Unnamed'}</strong><span className="muted small">{u.email}</span>{u.status !== 'active' ? <Badge>{u.status}</Badge> : null}</div>
                  <div className="row">
                    {u.roles.map((r) => (
                      <span key={r} className="role-chip">
                        <Badge staff={ROLE_DEFINITIONS[r].isStaff}>{ROLE_DEFINITIONS[r].name}</Badge>
                        {can('roles.assign') && r !== 'customer' && u.id !== me.profile.id ? (
                          <form action={revokeRoleAction}>
                            <input type="hidden" name="userId" value={u.id} /><input type="hidden" name="role" value={r} /><input type="hidden" name="returnTo" value={returnTo} />
                            <button className="chip-x" type="submit" aria-label={`Remove ${ROLE_DEFINITIONS[r].name} from ${u.fullName || u.email}`}>×</button>
                          </form>
                        ) : null}
                      </span>
                    ))}
                  </div>
                  {can('roles.assign') && u.id !== me.profile.id ? (
                    <form action={assignRoleAction} className="assign-form">
                      <input type="hidden" name="userId" value={u.id} /><input type="hidden" name="returnTo" value={returnTo} />
                      <label className="visually-hidden" htmlFor={`role-${u.id}`}>Role to grant</label>
                      <select id={`role-${u.id}`} name="role" className="select" defaultValue="seller">
                        {ROLE_CODES.filter((r) => r !== 'customer' && !u.roles.includes(r)).map((r) => <option key={r} value={r}>{ROLE_DEFINITIONS[r].name}</option>)}
                      </select>
                      <SubmitButton size="sm" variant="secondary" pendingText="Granting">Grant</SubmitButton>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <div className="pager">
            {offset > 0 ? <Link href={pageHref(offset - limit)}>Previous</Link> : <span />}
            {offset + limit < users.total ? <Link href={pageHref(offset + limit)}>Next</Link> : <span />}
          </div>
        </section>
      ) : null}

      {audit ? (
        <section className="stack" aria-labelledby="audit-title">
          <h2 id="audit-title">Recent audit log</h2>
          {audit.rows.length === 0 ? <p className="muted">No audited actions yet.</p> : (
            <ul className="audit-list">
              {audit.rows.map((a) => (
                <li key={a.id}><strong>{a.action}</strong><span className="muted">{new Date(a.createdAt).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })} · {a.entityType} {a.entityId ?? ''}</span></li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {!users && !audit && !can('sellers.read') && !can('catalog.moderate') && !can('categories.manage') && !can('orders.read') && !loadFailed ? <p className="muted">Your role does not include any modules available in this release.</p> : null}
    </div>
  );
}
