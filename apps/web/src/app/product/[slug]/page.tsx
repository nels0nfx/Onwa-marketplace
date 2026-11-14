import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatNaira, productSlugSchema, variantLabel, type PublicProduct } from '@onwa/shared';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { addToCartAction } from '@/app/cart/actions';
import { apiPublic } from '@/lib/api';
import { resolveMessage } from '@/lib/messages';
import { Alert } from '@/components/ui/Alert';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

async function load(slug: string): Promise<PublicProduct | null> {
  if (!productSlugSchema.safeParse(slug).success) return null;
  return (await apiPublic<{ product: PublicProduct }>(`/products/${slug}`))?.product ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  try {
    const p = await load(slug);
    return p ? { title: p.name, description: (p.description ?? `${p.name} on ONWA`).slice(0, 155) } : { title: 'Product not found' };
  } catch {
    return { title: 'Product' };
  }
}

export default async function ProductPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ e?: string; m?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const message = resolveMessage(sp.e ?? sp.m);
  const p = await load(slug);
  if (!p) notFound();
  const attrs = Object.entries(p.attributes);

  return (
    <div className="container page-wide stack-lg">
      <p className="crumbs"><Link href="/products">Products</Link>{p.category ? <> › <Link href={`/products?category=${p.category.slug}`}>{p.category.name}</Link></> : null}</p>
      <div className="product-layout">
        <div className="gallery">
          {p.images.length > 0 ? p.images.map((i) => <img key={i.id} className="product-img" src={i.url} alt={i.altText ?? p.name} />) : <span className="product-img product-img-empty" aria-hidden="true">{p.name.slice(0, 1)}</span>}
        </div>
        <div className="stack">
          <h1>{p.name}</h1>
          {p.brand ? <p className="muted">{p.brand}</p> : null}
          <p className="small muted">Sold by <Link href={`/store/${p.store.slug}`}>{p.store.name}</Link> · Condition: {p.condition}</p>

          <section className="stack" aria-labelledby="variants-title">
            <h2 id="variants-title" style={{ fontSize: '1.4rem' }}>{p.options.length ? 'Choices and prices' : 'Price'}</h2>
            <div>
              {p.variants.map((v) => (
                <div key={v.id} className="variant-row">
                  <span>{variantLabel(v.optionValues)}</span>
                  <span className="price">{formatNaira(v.salePriceKobo ?? v.priceKobo)}{v.salePriceKobo !== null ? <s>{formatNaira(v.priceKobo)}</s> : null}
                    <span className="muted small" style={{ marginLeft: 'var(--space-3)', fontWeight: 400 }}>{!v.inStock ? 'Out of stock' : v.lowStock ? 'Low stock' : 'In stock'}</span></span>
                </div>
              ))}
            </div>
            {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
            {p.variants.some((v) => v.inStock) ? (
              <form action={addToCartAction} className="stack">
                <input type="hidden" name="returnTo" value={`/product/${p.slug}`} />
                <div className="field"><label htmlFor="variantId">{p.options.length ? 'Choose an option' : 'Item'}</label>
                  <select id="variantId" name="variantId" className="select" required>
                    {p.variants.filter((v) => v.inStock).map((v) => <option key={v.id} value={v.id}>{variantLabel(v.optionValues)} · {formatNaira(v.salePriceKobo ?? v.priceKobo)}</option>)}
                  </select></div>
                <div className="field"><label htmlFor="quantity">Quantity</label><input id="quantity" name="quantity" className="input" style={{ maxWidth: '7rem' }} type="number" min={1} max={99} defaultValue={1} required /></div>
                <div><SubmitButton pendingText="Adding">Add to cart</SubmitButton></div>
              </form>
            ) : <p className="alert alert-info">This product is out of stock right now.</p>}
          </section>

          {p.description ? <section className="stack" aria-labelledby="desc-title"><h2 id="desc-title" style={{ fontSize: '1.4rem' }}>Description</h2><p className="prose">{p.description}</p></section> : null}
          {attrs.length > 0 ? (
            <section className="stack" aria-labelledby="attrs-title"><h2 id="attrs-title" style={{ fontSize: '1.4rem' }}>Details</h2>
              <dl className="kv">{attrs.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></section>
          ) : null}
          {p.weightGrams || p.shippingRequirements ? (
            <section className="stack" aria-labelledby="ship-title"><h2 id="ship-title" style={{ fontSize: '1.4rem' }}>Shipping</h2>
              {p.weightGrams ? <p className="muted">Weight: {p.weightGrams >= 1000 ? `${p.weightGrams / 1000} kg` : `${p.weightGrams} g`}</p> : null}
              {p.shippingRequirements ? <p className="prose">{p.shippingRequirements}</p> : null}</section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
