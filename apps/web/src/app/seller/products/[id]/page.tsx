import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  PRODUCT_CONDITIONS, PRODUCT_STATUS_LABELS, STOCK_REASONS_SELLER, attributesToText, formatNaira, isProductEditable, koboToNairaInput,
  productMissing, uuidSchema, variantLabel, type SellerProduct, type StockMovement,
} from '@onwa/shared';
import { Alert } from '@/components/ui/Alert';
import { Field, SelectField, TextArea } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { ApiError, apiRequest } from '@/lib/api';
import { loadCategories } from '@/lib/catalogData';
import { resolveMessage } from '@/lib/messages';
import { requireSession } from '@/lib/session';
import {
  addVariantAction, adjustStockAction, productStatusAction, removeProductImageAction, updateProductAction, updateVariantAction,
  uploadProductImageAction,
} from '../actions';

export const metadata: Metadata = { title: 'Manage product' };
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

function StatusButton({ id, action, label, variant = 'secondary' }: { id: string; action: string; label: string; variant?: 'primary' | 'secondary' | 'danger' }) {
  return (
    <form action={productStatusAction}>
      <input type="hidden" name="id" value={id} /><input type="hidden" name="action" value={action} />
      <SubmitButton variant={variant} size="sm" pendingText="Saving">{label}</SubmitButton>
    </form>
  );
}

export default async function ManageProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string; f?: string; m?: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const { token } = await requireSession(`/seller/products/${id}`);
  const sp = await searchParams;
  const message = resolveMessage(sp.e ?? sp.m, sp.f);

  let product: SellerProduct;
  let movements: StockMovement[] = [];
  try {
    product = (await apiRequest<{ product: SellerProduct }>(`/seller/products/${id}`, { token })).product;
    movements = (await apiRequest<{ movements: StockMovement[] }>(`/seller/products/${id}/movements?limit=15`, { token })).movements;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    return <div className="container page-medium stack"><Alert tone="error">We could not load this product. Try again in a moment.</Alert></div>;
  }
  const { options: categories } = await loadCategories();
  const categoryOptions = [{ value: '', label: 'Choose a category' }, ...categories.map((o) => ({ value: o.value, label: o.label }))];
  const conditionOptions = PRODUCT_CONDITIONS.map((c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }));

  const status = product.status;
  const editable = isProductEditable(status);
  const structureEditable = status !== 'pending_review' && status !== 'archived';
  const missing = productMissing(product);
  const canSubmit = (status === 'draft' || status === 'changes_requested' || status === 'rejected') && missing.length === 0;
  const variantName = new Map(product.variants.map((v) => [v.id, variantLabel(v.optionValues)]));

  return (
    <div className="container page-medium stack-lg">
      <div className="page-head">
        <h1>{product.name}</h1>
        <div className="row">
          <span className="status-pill" data-status={status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : status === 'draft' || status === 'archived' ? 'draft' : 'submitted'}>{PRODUCT_STATUS_LABELS[status]}</span>
          {status === 'approved' ? <Link href={`/product/${product.slug}`}>View live page</Link> : null}
          <Link href="/seller/products">All products</Link>
        </div>
      </div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {product.reviewNote && (status === 'changes_requested' || status === 'rejected') ? <Alert tone={status === 'rejected' ? 'error' : 'info'}><strong>Message from our review team:</strong> {product.reviewNote}</Alert> : null}
      {status === 'pending_review' ? <Alert tone="info">This listing is awaiting review. You cannot edit it until it is decided, unless you withdraw it.</Alert> : null}
      {status === 'approved' ? <Alert tone="info">This listing is live. Changing its name, description, category, brand, attributes or images sends it back to review and removes it from the catalogue until it is approved again. Prices and stock can change freely.</Alert> : null}

      <section className="card stack" aria-labelledby="status-title">
        <h2 id="status-title">Publishing</h2>
        {status === 'draft' || status === 'changes_requested' || status === 'rejected' ? (
          missing.length > 0
            ? <div className="alert alert-info"><strong>Before you can submit:</strong><ul className="checklist">{missing.map((m) => <li key={m}>{m}</li>)}</ul></div>
            : <div className="alert alert-success">Everything required is in place.</div>
        ) : null}
        <div className="row">
          {canSubmit ? <StatusButton id={product.id} action="submit" label="Submit for review" variant="primary" /> : null}
          {status === 'pending_review' ? <StatusButton id={product.id} action="withdraw" label="Withdraw from review" /> : null}
          {status !== 'archived' && status !== 'pending_review' ? <StatusButton id={product.id} action="archive" label="Archive" variant="danger" /> : null}
          {status === 'archived' ? <StatusButton id={product.id} action="restore" label="Restore as draft" /> : null}
        </div>
      </section>

      <section className="card stack" aria-labelledby="images-title">
        <h2 id="images-title">Images</h2>
        <p className="hint">Up to 8 images, JPG, PNG or WebP, 4 MB each. The first one is the main picture.</p>
        {product.images.length > 0 ? (
          <ul className="list-plain" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(9rem, 1fr))' }}>
            {product.images.map((i) => (
              <li key={i.id} className="stack">
                <img className="product-img" src={i.url} alt={i.altText ?? `${product.name} picture ${i.position + 1}`} />
                {structureEditable ? <form action={removeProductImageAction}><input type="hidden" name="productId" value={product.id} /><input type="hidden" name="imageId" value={i.id} /><SubmitButton size="sm" variant="danger" pendingText="Removing">Remove</SubmitButton></form> : null}
              </li>
            ))}
          </ul>
        ) : <p className="muted">No images yet.</p>}
        {structureEditable && product.images.length < 8 ? (
          <form action={uploadProductImageAction} className="stack" encType="multipart/form-data">
            <input type="hidden" name="id" value={product.id} />
            <div className="field"><label htmlFor="file">Add an image</label><input id="file" name="file" type="file" accept="image/jpeg,image/png,image/webp" className="input" required /></div>
            <div><SubmitButton variant="secondary" pendingText="Uploading">Upload image</SubmitButton></div>
          </form>
        ) : null}
      </section>

      <section className="card stack" aria-labelledby="details-title">
        <h2 id="details-title">Details</h2>
        <form action={updateProductAction} className="stack">
          <input type="hidden" name="id" value={product.id} />
          <fieldset disabled={!editable} className="stack" style={{ border: 0, padding: 0 }}>
            <Field id="name" label="Product name" defaultValue={product.name} required minLength={3} maxLength={120} />
            <div className="form-grid cols-2">
              <SelectField id="categoryId" label="Category" options={categoryOptions} defaultValue={product.categoryId ?? ''} />
              <SelectField id="condition" label="Condition" options={conditionOptions} defaultValue={product.condition} />
              <Field id="brand" label="Brand" defaultValue={product.brand ?? ''} maxLength={80} />
            </div>
            <TextArea id="description" label="Description" defaultValue={product.description ?? ''} maxLength={5000} />
            <div className="form-grid cols-2">
              <Field id="weightGrams" label="Weight (grams)" inputMode="numeric" defaultValue={product.weightGrams ?? ''} />
              <Field id="lengthCm" label="Length (cm)" inputMode="numeric" defaultValue={product.lengthCm ?? ''} />
              <Field id="widthCm" label="Width (cm)" inputMode="numeric" defaultValue={product.widthCm ?? ''} />
              <Field id="heightCm" label="Height (cm)" inputMode="numeric" defaultValue={product.heightCm ?? ''} />
            </div>
            <TextArea id="shippingRequirements" label="Shipping requirements" rows={2} defaultValue={product.shippingRequirements ?? ''} maxLength={500} />
            <TextArea id="attributesText" label="Attributes" rows={3} defaultValue={attributesToText(product.attributes)} hint={'One per line, like "Material: Cotton".'} />
            {editable ? <div><SubmitButton pendingText="Saving">Save details</SubmitButton></div> : null}
          </fieldset>
        </form>
      </section>

      <section className="stack" aria-labelledby="variants-title">
        <h2 id="variants-title">Variants, prices and stock</h2>
        {product.options.length > 0 ? <p className="muted small">Options: {product.options.map((o) => `${o.name} (${o.values.join(', ')})`).join('; ')}. Options cannot be changed after creation; add or switch off variants instead.</p> : null}
        <ul className="list-plain">
          {product.variants.map((v) => (
            <li key={v.id} className="item">
              <div className="item-head"><strong>{variantLabel(v.optionValues)}</strong><span className="muted small">{v.stockQuantity} in stock{v.isActive ? '' : ' · inactive'}</span></div>
              <details>
                <summary className="small">Edit price and settings</summary>
                <form action={updateVariantAction} className="stack" style={{ marginTop: 'var(--space-3)' }}>
                  <input type="hidden" name="productId" value={product.id} /><input type="hidden" name="variantId" value={v.id} />
                  <div className="form-grid cols-2">
                    <Field id={`price-${v.id}`} name="price" label="Price (₦)" inputMode="decimal" defaultValue={koboToNairaInput(v.priceKobo)} required />
                    <Field id={`sale-${v.id}`} name="salePrice" label="Sale price (₦)" inputMode="decimal" defaultValue={v.salePriceKobo !== null ? koboToNairaInput(v.salePriceKobo) : ''} />
                    <Field id={`sku-${v.id}`} name="sku" label="SKU" defaultValue={v.sku ?? ''} maxLength={60} />
                  </div>
                  <label className="check"><input type="checkbox" name="isActive" defaultChecked={v.isActive} /><span>Available to customers</span></label>
                  <div><SubmitButton size="sm" variant="secondary" pendingText="Saving">Save variant</SubmitButton></div>
                </form>
              </details>
              <details>
                <summary className="small">Adjust stock</summary>
                <form action={adjustStockAction} className="stack" style={{ marginTop: 'var(--space-3)' }}>
                  <input type="hidden" name="productId" value={product.id} /><input type="hidden" name="variantId" value={v.id} />
                  <div className="form-grid cols-2">
                    <Field id={`delta-${v.id}`} name="delta" label="Change (use - to remove)" inputMode="numeric" required hint="For example 20 to add, -2 to remove." />
                    <SelectField id={`reason-${v.id}`} name="reason" label="Reason" options={STOCK_REASONS_SELLER.map((r) => ({ value: r, label: r.charAt(0).toUpperCase() + r.slice(1) }))} defaultValue="restock" />
                  </div>
                  <Field id={`note-${v.id}`} name="note" label="Note (optional)" maxLength={200} />
                  <div><SubmitButton size="sm" variant="secondary" pendingText="Saving">Update stock</SubmitButton></div>
                </form>
              </details>
            </li>
          ))}
        </ul>

        {structureEditable && product.variants.length < 100 ? (
          <details className="card">
            <summary>Add a variant</summary>
            <form action={addVariantAction} className="stack" style={{ marginTop: 'var(--space-4)' }}>
              <input type="hidden" name="id" value={product.id} />
              <div className="form-grid cols-2">
                {product.options.map((o) => (
                  <SelectField key={o.name} id={`opt_${o.name}`} label={o.name} options={o.values.map((x) => ({ value: x, label: x }))} defaultValue={o.values[0] ?? ''} />
                ))}
                <Field id="price" label="Price (₦)" inputMode="decimal" required />
                <Field id="salePrice" label="Sale price (₦, optional)" inputMode="decimal" />
                <Field id="initialStock" label="Stock on hand" inputMode="numeric" defaultValue="0" />
                <Field id="sku" label="SKU (optional)" maxLength={60} />
              </div>
              <div><SubmitButton variant="secondary" pendingText="Adding">Add variant</SubmitButton></div>
            </form>
          </details>
        ) : null}
      </section>

      <section className="stack" aria-labelledby="history-title">
        <h2 id="history-title">Stock history</h2>
        {movements.length === 0 ? <p className="muted">No stock movements yet.</p> : (
          <ul className="audit-list">
            {movements.map((m) => (
              <li key={m.id}><strong>{m.delta > 0 ? `+${m.delta}` : m.delta} · {variantName.get(m.variantId) ?? 'Variant'}</strong>
                <span className="muted">{m.reason} · now {m.quantityAfter} · {new Date(m.createdAt).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}{m.note ? ` · ${m.note}` : ''}</span></li>
            ))}
          </ul>
        )}
        <p className="muted small">Prices are stored in kobo (₦1 = 100 kobo), for example {formatNaira(150050)} is 150,050 kobo.</p>
      </section>
    </div>
  );
}
