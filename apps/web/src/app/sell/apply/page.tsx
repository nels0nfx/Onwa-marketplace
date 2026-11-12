import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  DOCUMENT_KIND_LABELS, DOCUMENT_KINDS, ID_TYPES, NG_STATES, SELLER_CATEGORY_OPTIONS, STATUS_LABELS, canApplicantSubmit,
  missingForSubmission, type SellerApplication,
} from '@onwa/shared';
import { Alert } from '@/components/ui/Alert';
import { Field, SelectField, TextArea } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { apiRequest } from '@/lib/api';
import { resolveMessage } from '@/lib/messages';
import { loadMe, requireSession } from '@/lib/session';
import { removeDocumentAction, saveApplicationAction, uploadDocumentAction } from './actions';

export const metadata: Metadata = { title: 'Seller application' };
export const maxDuration = 45;

const STATE_OPTIONS = [{ value: '', label: 'Choose a state' }, ...NG_STATES.map((s) => ({ value: s, label: s }))];
const ID_OPTIONS = [{ value: '', label: 'Choose a document type' }, ...ID_TYPES.map((t) => ({ value: t.code, label: t.label }))];
const KIND_OPTIONS = DOCUMENT_KINDS.map((k) => ({ value: k, label: DOCUMENT_KIND_LABELS[k] }));

function Summary({ app }: { app: SellerApplication }) {
  const rows: [string, string | null][] = [
    ['Legal name', app.legalName], ['Business name', app.businessName], ['Contact email', app.contactEmail], ['Contact phone', app.contactPhone],
    ['Address', [app.addressLine1, app.addressCity, app.addressLga, app.addressState].filter(Boolean).join(', ') || null],
    ['Categories', app.categories.join(', ') || null], ['Description', app.description],
  ];
  return <dl className="kv">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v ?? 'Not provided'}</dd></div>)}</dl>;
}

export default async function ApplyPage({ searchParams }: { searchParams: Promise<{ e?: string; f?: string; m?: string }> }) {
  const { token } = await requireSession('/sell/apply');
  const sp = await searchParams;
  const message = resolveMessage(sp.e ?? sp.m, sp.f);

  const { me } = await loadMe(token);
  if (me?.roles.includes('seller')) redirect('/seller');

  let app: SellerApplication | null = null;
  let failed = false;
  try {
    app = (await apiRequest<{ application: SellerApplication | null }>('/seller/application', { token })).application;
  } catch {
    failed = true;
  }
  if (failed) {
    return <div className="container page-medium stack"><h1>Seller application</h1><Alert tone="error">We could not load your application. Try again in a moment.</Alert></div>;
  }
  if (app?.status === 'approved') redirect('/seller');

  const rejected = app?.status === 'rejected';
  const editable = !app || rejected || canApplicantSubmit(app.status);
  const docsAllowed = !!app && !rejected && canApplicantSubmit(app.status);
  const missing = app && docsAllowed ? missingForSubmission(app as unknown as Record<string, unknown> & { categories: string[] }, app.documents.map((d) => d.kind)) : [];

  return (
    <div className="container page-medium stack-lg">
      <div className="page-head">
        <h1>Seller application</h1>
        {app ? <p><span className="status-pill" data-status={app.status}>{STATUS_LABELS[app.status]}</span></p> : <p className="muted">Fill in what you can and save as a draft. You can come back any time.</p>}
        <p className="small"><Link href="/sell">How selling works</Link></p>
      </div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {app?.reviewerNote && (app.status === 'more_info_required' || rejected) ? (
        <Alert tone={rejected ? 'error' : 'info'}><strong>Message from our review team:</strong> {app.reviewerNote}</Alert>
      ) : null}
      {rejected ? <Alert tone="info">This application was not approved. You can correct the details below and apply again. Saving starts a new application, so documents must be uploaded again.</Alert> : null}

      {app && !editable ? (
        <section className="card stack" aria-labelledby="summary-title">
          <h2 id="summary-title">Your application</h2>
          <p className="muted">It is {STATUS_LABELS[app.status].toLowerCase()}. You cannot edit it while it is being reviewed.</p>
          <Summary app={app} />
        </section>
      ) : (
        <form action={saveApplicationAction} className="stack-lg">
          <fieldset className="stack"><legend>About you and your business</legend>
            <div className="form-grid cols-2">
              <Field id="legalName" label="Legal name" defaultValue={app?.legalName ?? ''} maxLength={120} hint="As it appears on your identity document." />
              <Field id="businessName" label="Business or trading name" defaultValue={app?.businessName ?? ''} maxLength={80} hint="This becomes your store name." />
              <Field id="contactEmail" label="Contact email" type="email" defaultValue={app?.contactEmail ?? ''} />
              <Field id="contactPhone" label="Contact phone" type="tel" defaultValue={app?.contactPhone ?? ''} />
            </div>
            <TextArea id="description" label="Business description" defaultValue={app?.description ?? ''} maxLength={1000} hint="What you sell and what makes it special. At least 30 characters." />
          </fieldset>

          <fieldset className="stack"><legend>Business address</legend>
            <div className="form-grid cols-2">
              <Field id="addressLine1" label="Street address" defaultValue={app?.addressLine1 ?? ''} maxLength={150} />
              <Field id="addressCity" label="City or town" defaultValue={app?.addressCity ?? ''} maxLength={80} />
              <Field id="addressLga" label="LGA" defaultValue={app?.addressLga ?? ''} maxLength={80} />
              <SelectField id="addressState" label="State" options={STATE_OPTIONS} defaultValue={app?.addressState ?? ''} />
            </div>
          </fieldset>

          <fieldset className="stack"><legend>Selling categories</legend>
            <p className="hint">Choose up to 6.</p>
            <div className="check-grid">
              {SELLER_CATEGORY_OPTIONS.map((c) => (
                <label key={c} className="check"><input type="checkbox" name="categories" value={c} defaultChecked={app?.categories.includes(c) ?? false} /><span>{c}</span></label>
              ))}
            </div>
          </fieldset>

          <fieldset className="stack"><legend>Identity</legend>
            <SelectField id="idType" label="Identity document type" options={ID_OPTIONS} defaultValue={app?.idType ?? ''} hint="Upload the document itself in the next section. We do not ask you to type your ID number." />
          </fieldset>

          <fieldset className="stack"><legend>Payout account</legend>
            <p className="hint">Where your earnings will be paid. Payouts open in a later release; details are kept private and used only for verification and payouts.</p>
            <div className="form-grid cols-2">
              <Field id="bankName" label="Bank name" defaultValue={app?.bankName ?? ''} maxLength={60} />
              <Field id="bankAccountNumber" label="Account number" defaultValue={app?.bankAccountNumber ?? ''} inputMode="numeric" maxLength={10} hint="10 digits." />
              <Field id="bankAccountName" label="Account name" defaultValue={app?.bankAccountName ?? ''} maxLength={100} />
            </div>
          </fieldset>

          <div className="row">
            <button className="btn btn-secondary" type="submit" name="intent" value="save">Save draft</button>
            {!rejected ? <button className="btn btn-primary" type="submit" name="intent" value="submit">Save and submit for review</button> : null}
          </div>
          {rejected ? <p className="hint">Save your corrected draft first, upload your documents, then submit.</p> : null}
        </form>
      )}

      {docsAllowed && app ? (
        <section className="card stack" aria-labelledby="docs-title">
          <h2 id="docs-title">Documents</h2>
          <p className="hint">Accepted: PDF, JPG or PNG, up to 5 MB each. An identity document is required; a CAC certificate is optional.</p>
          {app.documents.length > 0 ? (
            <ul className="list-plain">
              {app.documents.map((d) => (
                <li key={d.id} className="item">
                  <div className="item-head"><strong>{DOCUMENT_KIND_LABELS[d.kind]}</strong><span className="muted small">{Math.max(1, Math.round(d.sizeBytes / 1024))} KB</span></div>
                  <span className="muted small">{d.originalName}</span>
                  <form action={removeDocumentAction}><input type="hidden" name="id" value={d.id} /><SubmitButton size="sm" variant="danger" pendingText="Removing">Remove</SubmitButton></form>
                </li>
              ))}
            </ul>
          ) : <p className="muted">No documents uploaded yet.</p>}
          <form action={uploadDocumentAction} className="stack" encType="multipart/form-data">
            <SelectField id="kind" label="Document type" options={KIND_OPTIONS} defaultValue="identity" />
            <div className="field"><label htmlFor="file">File</label><input id="file" name="file" type="file" accept="application/pdf,image/jpeg,image/png" className="input" required /></div>
            <div><SubmitButton variant="secondary" pendingText="Uploading">Upload document</SubmitButton></div>
          </form>
          {missing.length > 0 ? (
            <div className="alert alert-info"><strong>Still needed:</strong> {missing.join(', ')}.</div>
          ) : <div className="alert alert-success">Everything required is in place. You can submit for review.</div>}
        </section>
      ) : null}

      {!app ? <p className="muted small">Save your draft first. Document uploads appear once a draft exists.</p> : null}
    </div>
  );
}
