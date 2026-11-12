import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  DOCUMENT_KIND_LABELS, ID_TYPES, STATUS_LABELS, availableReviewActions, uuidSchema, type AdminApplicationDetail,
} from '@onwa/shared';
import { Alert } from '@/components/ui/Alert';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { ApiError, apiRequest } from '@/lib/api';
import { resolveMessage } from '@/lib/messages';
import { loadMe, requireSession } from '@/lib/session';
import { decideApplicationAction } from '../actions';

export const metadata: Metadata = { title: 'Seller application' };
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

const ACTION_LABELS = { start_review: 'Start review', request_info: 'Request more information', approve: 'Approve seller', reject: 'Reject application' } as const;

export default async function AdminApplicationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string; f?: string; m?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!uuidSchema.safeParse(id).success) notFound();
  const { token } = await requireSession(`/admin/sellers/${id}`);
  const { me, apiDown } = await loadMe(token);
  if (apiDown) return <div className="container page-wide"><Alert tone="error">The administration service is unavailable. Try again shortly.</Alert></div>;
  if (!me || !me.permissions.includes('sellers.read')) notFound();
  const canReview = me.permissions.includes('sellers.review');
  const message = resolveMessage(sp.e ?? sp.m, sp.f);

  let app: AdminApplicationDetail;
  try {
    app = (await apiRequest<{ application: AdminApplicationDetail }>(`/admin/seller-applications/${id}`, { token })).application;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    return <div className="container page-wide"><Alert tone="error">We could not load this application. Try again.</Alert></div>;
  }

  const idLabel = ID_TYPES.find((t) => t.code === app.idType)?.label ?? app.idType;
  const rows: [string, string | null][] = [
    ['Applicant', `${app.applicant.fullName} (${app.applicant.email})`], ['Legal name', app.legalName], ['Business name', app.businessName],
    ['Contact email', app.contactEmail], ['Contact phone', app.contactPhone],
    ['Business address', [app.addressLine1, app.addressCity, app.addressLga, app.addressState].filter(Boolean).join(', ') || null],
    ['Categories', app.categories.join(', ') || null], ['Description', app.description], ['Identity document type', idLabel],
    ['Bank', app.bankName], ['Account number', app.bankAccountNumber], ['Account name', app.bankAccountName],
  ];
  const actions = canReview ? availableReviewActions(app.status) : [];

  return (
    <div className="container page-wide stack-lg">
      <div className="page-head">
        <h1>{app.businessName || app.legalName || 'Application'}</h1>
        <p><span className="status-pill" data-status={app.status}>{STATUS_LABELS[app.status]}</span></p>
        <p className="small"><Link href="/admin/sellers">Back to sellers</Link></p>
      </div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {app.reviewerNote ? <Alert tone="info"><strong>Latest note:</strong> {app.reviewerNote}</Alert> : null}

      <section className="card stack" aria-labelledby="details-title">
        <h2 id="details-title">Details</h2>
        <dl className="kv">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v ?? 'Not provided'}</dd></div>)}</dl>
      </section>

      <section className="card stack" aria-labelledby="docs-title">
        <h2 id="docs-title">Documents</h2>
        <p className="hint">Links are private and expire after a few minutes. Reload the page for fresh links.</p>
        {app.documents.length === 0 ? <p className="muted">No documents uploaded.</p> : (
          <ul className="list-plain">
            {app.documents.map((d) => (
              <li key={d.id} className="item">
                <strong>{DOCUMENT_KIND_LABELS[d.kind]}</strong>
                <span className="muted small">{d.originalName} · {Math.max(1, Math.round(d.sizeBytes / 1024))} KB</span>
                {d.url ? <a href={d.url} target="_blank" rel="noopener noreferrer">Open file</a> : <span className="muted small">Link unavailable</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {actions.length > 0 ? (
        <section className="card stack" aria-labelledby="decision-title">
          <h2 id="decision-title">Decision</h2>
          {actions.map((a) => {
            const needsNote = a === 'request_info' || a === 'reject';
            return (
              <form key={a} action={decideApplicationAction} className="stack">
                <input type="hidden" name="id" value={app.id} />
                <input type="hidden" name="decision" value={a} />
                {needsNote ? (
                  <div className="field">
                    <label htmlFor={`note-${a}`}>{a === 'reject' ? 'Reason for rejection (shown to the applicant)' : 'What do you need from the applicant? (shown to them)'}</label>
                    <textarea id={`note-${a}`} name="note" className="input textarea" minLength={5} maxLength={1000} required />
                  </div>
                ) : null}
                <div><SubmitButton variant={a === 'reject' ? 'danger' : a === 'approve' ? 'primary' : 'secondary'} pendingText="Saving">{ACTION_LABELS[a]}</SubmitButton></div>
              </form>
            );
          })}
          <p className="hint">Approving opens the seller's storefront and grants the seller role. It does not approve any future listings.</p>
        </section>
      ) : null}

      <section className="stack" aria-labelledby="history-title">
        <h2 id="history-title">History</h2>
        <ol className="timeline">
          {app.events.map((e) => (
            <li key={e.id}>
              <strong>{e.fromStatus ? `${STATUS_LABELS[e.fromStatus as keyof typeof STATUS_LABELS] ?? e.fromStatus} → ` : ''}{STATUS_LABELS[e.toStatus as keyof typeof STATUS_LABELS] ?? e.toStatus}</strong>
              <span className="muted small">{new Date(e.createdAt).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}</span>
              {e.note ? <span>{e.note}</span> : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
