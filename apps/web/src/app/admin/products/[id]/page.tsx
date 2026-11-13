import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PRODUCT_STATUS_LABELS, formatNaira, productMissing, uuidSchema, variantLabel, type AdminProductDetail } from '@onwa/shared';
import { Alert } from '@/components/ui/Alert';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { ApiError, apiRequest } from '@/lib/api';
import { resolveMessage } from '@/lib/messages';
import { loadMe, requireSession } from '@/lib/session';
import { decideProductAction } from '../actions';

export const metadata: Metadata = { title: 'Review listing' };
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

export default async function AdminProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string; f?: string; m?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!uuidSchema.safeParse(id).success) notFound();
  const { token } = await requireSession(`/admin/products/${id}`);
  const { me, apiDown } = await loadMe(token);
  if (apiDown) return <div className="container page-wide"><Alert tone="error">The administration service is unavailable. Try again shortly.</Alert></div>;
  if (!me || !me.permissions.includes('catalog.moderate')) notFound();
  const message = resolveMessage(sp.e ?? sp.m, sp.f);

  let p: AdminProductDetail;
  try {
    p = (await apiRequest<{ product: AdminProductDetail }>(`/admin/products/${id}`, { token })).product;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    return <div className="container page-wide"><Alert tone="error">We could not load this listing. Try again.</Alert></div>;
  }
  const missing = productMissing(p);
  const attrs = Object.entries(p.attributes);

  return (
    <div className="container page-wide stack-lg">
      <div className="page-head">
        <h1>{p.name}</h1>
        <p><span className="status-pill" data-status={p.status === 'approved' ? 'approved' : p.status === 'rejected' ? 'rejected' : 'submitted'}>{PRODUCT_STATUS_LABELS[p.status]}</span></p>
        <p className="small"><Link href="/admin/products">Back to moderation</Link> · Seller: <Link href={`/store/${p.storeSlug}`}>{p.storeName}</Link></p>
      </div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {p.reviewNote ? <Alert tone="info"><strong>Latest note:</strong> {p.reviewNote}</Alert> : null}

      <section className="card stack" aria-labelledby="info-title">
        <h2 id="info-title">Details</h2>
        <dl className="kv">
          <div><dt>Category</dt><dd>{p.categoryName ?? 'None'}</dd></div>
          <div><dt>Brand</dt><dd>{p.brand ?? 'None'}</dd></div>
          <div><dt>Condition</dt><dd>{p.condition}</dd></div>
          <div><dt>Description</dt><dd className="prose">{p.description ?? 'None'}</dd></div>
          <div><dt>Weight</dt><dd>{p.weightGrams ? `${p.weightGrams} g` : 'None'}</dd></div>
          <div><dt>Size (cm)</dt><dd>{[p.lengthCm, p.widthCm, p.heightCm].every((x) => x) ? `${p.lengthCm} × ${p.widthCm} × ${p.heightCm}` : 'Not given'}</dd></div>
          <div><dt>Shipping notes</dt><dd>{p.shippingRequirements ?? 'None'}</dd></div>
          {attrs.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      </section>

      <section className="card stack" aria-labelledby="img-title">
        <h2 id="img-title">Images</h2>
        {p.images.length === 0 ? <p className="muted">No images.</p> : <div className="gallery">{p.images.map((i) => <img key={i.id} className="product-img" src={i.url} alt={i.altText ?? p.name} />)}</div>}
      </section>

      <section className="card stack" aria-labelledby="var-title">
        <h2 id="var-title">Variants</h2>
        {p.variants.map((v) => (
          <div key={v.id} className="variant-row"><span>{variantLabel(v.optionValues)}{v.sku ? ` · ${v.sku}` : ''}{v.isActive ? '' : ' (inactive)'}</span>
            <span>{formatNaira(v.salePriceKobo ?? v.priceKobo)}{v.salePriceKobo !== null ? ` (was ${formatNaira(v.priceKobo)})` : ''} · {v.stockQuantity} in stock</span></div>
        ))}
      </section>

      {p.status === 'pending_review' ? (
        <section className="card stack" aria-labelledby="decision-title">
          <h2 id="decision-title">Decision</h2>
          {missing.length > 0 ? <Alert tone="error">This listing is incomplete: {missing.join(', ')}. It cannot be approved.</Alert> : null}
          {(['approve', 'request_changes', 'reject'] as const).map((a) => {
            if (a === 'approve' && missing.length > 0) return null;
            const needsNote = a !== 'approve';
            return (
              <form key={a} action={decideProductAction} className="stack">
                <input type="hidden" name="id" value={p.id} /><input type="hidden" name="decision" value={a} />
                {needsNote ? (
                  <div className="field"><label htmlFor={`note-${a}`}>{a === 'reject' ? 'Reason for rejection (shown to the seller)' : 'What needs to change? (shown to the seller)'}</label>
                    <textarea id={`note-${a}`} name="note" className="input textarea" minLength={5} maxLength={1000} required /></div>
                ) : null}
                <div><SubmitButton variant={a === 'approve' ? 'primary' : a === 'reject' ? 'danger' : 'secondary'} pendingText="Saving">{a === 'approve' ? 'Approve listing' : a === 'request_changes' ? 'Request changes' : 'Reject listing'}</SubmitButton></div>
              </form>
            );
          })}
        </section>
      ) : null}

      <section className="stack" aria-labelledby="hist-title">
        <h2 id="hist-title">History</h2>
        <ol className="timeline">
          {p.events.map((e) => (
            <li key={e.id}>
              <strong>{e.fromStatus ? `${PRODUCT_STATUS_LABELS[e.fromStatus as keyof typeof PRODUCT_STATUS_LABELS] ?? e.fromStatus} → ` : ''}{PRODUCT_STATUS_LABELS[e.toStatus as keyof typeof PRODUCT_STATUS_LABELS] ?? e.toStatus}</strong>
              <span className="muted small">{new Date(e.createdAt).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}</span>
              {e.note ? <span>{e.note}</span> : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
