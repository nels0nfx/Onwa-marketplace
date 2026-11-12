import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { STORE_ACCENTS, type StoreProfile } from '@onwa/shared';
import { Alert } from '@/components/ui/Alert';
import { ButtonLink } from '@/components/ui/Button';
import { Field, TextArea } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { ApiError, apiRequest } from '@/lib/api';
import { resolveMessage } from '@/lib/messages';
import { requireSession } from '@/lib/session';
import { saveStoreAction, uploadStoreMediaAction } from './actions';

export const metadata: Metadata = { title: 'Seller dashboard' };
export const maxDuration = 45;

export default async function SellerPage({ searchParams }: { searchParams: Promise<{ e?: string; f?: string; m?: string }> }) {
  const { token } = await requireSession('/seller');
  const sp = await searchParams;
  const message = resolveMessage(sp.e ?? sp.m, sp.f);

  let store: StoreProfile;
  try {
    store = (await apiRequest<{ store: StoreProfile }>('/seller/store', { token })).store;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) redirect('/sell');
    return <div className="container page-medium stack"><h1>Seller dashboard</h1><Alert tone="error">We could not load your store. Try again in a moment.</Alert></div>;
  }
  const suspended = store.sellerStatus === 'suspended';

  return (
    <div className="container page-medium stack-lg" data-accent={store.accent}>
      <div className="page-head">
        <h1>Seller dashboard</h1>
        <div className="row">
          <span className="status-pill" data-status={store.sellerStatus}>{suspended ? 'Suspended' : 'Active'}</span>
          {!suspended ? <Link href={`/store/${store.slug}`}>View your public storefront</Link> : null}
        </div>
        <p className="muted">Products, digital items, services, orders and earnings arrive in upcoming releases. For now you can set up your storefront.</p>
      </div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {suspended ? <Alert tone="error">Your seller account is suspended, so your storefront is hidden and you cannot edit it. Contact support if you think this is a mistake.</Alert> : null}

      <section className="card stack" aria-labelledby="media-title">
        <h2 id="media-title">Logo and cover</h2>
        <div className="row">
          {store.logoUrl ? <img className="logo-sm" src={store.logoUrl} alt="Current store logo" /> : <span className="logo-sm" aria-hidden="true">{store.name.slice(0, 1)}</span>}
          {store.coverUrl ? <img className="preview-img" src={store.coverUrl} alt="Current store cover" /> : null}
        </div>
        {!suspended ? (
          <>
            {(['logo', 'cover'] as const).map((kind) => (
              <form key={kind} action={uploadStoreMediaAction} className="stack" encType="multipart/form-data">
                <input type="hidden" name="kind" value={kind} />
                <div className="field">
                  <label htmlFor={`file-${kind}`}>{kind === 'logo' ? 'Upload a logo' : 'Upload a cover image'}</label>
                  <input id={`file-${kind}`} name="file" type="file" accept="image/jpeg,image/png,image/webp" className="input" required />
                  <p className="hint">JPG, PNG or WebP, up to {kind === 'logo' ? '2' : '4'} MB.{kind === 'logo' ? ' A square image works best.' : ' A wide image works best.'}</p>
                </div>
                <div><SubmitButton variant="secondary" pendingText="Uploading">{kind === 'logo' ? 'Save logo' : 'Save cover'}</SubmitButton></div>
              </form>
            ))}
          </>
        ) : null}
      </section>

      <section className="card stack" aria-labelledby="details-title">
        <h2 id="details-title">Store details</h2>
        <p className="hint">Your store address is <strong>/store/{store.slug}</strong>. It is set when your application is approved and does not change. Text is shown exactly as you type it; formatting and links are not supported.</p>
        <form action={saveStoreAction} className="stack">
          <fieldset disabled={suspended} className="stack" style={{ border: 0, padding: 0 }}>
            <Field id="name" label="Store name" defaultValue={store.name} required maxLength={80} />
            <Field id="tagline" label="Tagline" defaultValue={store.tagline ?? ''} maxLength={120} />
            <TextArea id="description" label="About your store" defaultValue={store.description ?? ''} maxLength={1000} />
            <TextArea id="deliveryInfo" label="Delivery information" defaultValue={store.deliveryInfo ?? ''} maxLength={1000} hint="Where you deliver, typical timeframes and costs." />
            <TextArea id="policies" label="Store policies" defaultValue={store.policies ?? ''} maxLength={2000} hint="Returns, refunds, cancellations and anything else customers should know." />
            <div className="field">
              <span className="field-label">Accent colour</span>
              <div className="swatches" role="radiogroup" aria-label="Accent colour">
                {STORE_ACCENTS.map((a) => (
                  <label key={a} className="swatch" data-accent={a}>
                    <input type="radio" name="accent" value={a} defaultChecked={store.accent === a} required />
                    <i aria-hidden="true" />{a.charAt(0).toUpperCase() + a.slice(1)}
                  </label>
                ))}
              </div>
            </div>
            {!suspended ? <div><SubmitButton pendingText="Saving">Save store details</SubmitButton></div> : null}
          </fieldset>
        </form>
      </section>
      <div><ButtonLink href="/account" variant="ghost">Back to your account</ButtonLink></div>
    </div>
  );
}
