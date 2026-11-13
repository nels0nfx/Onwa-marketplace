import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatNaira, productSlugSchema, variantLabel, type PublicProduct } from '@onwa/shared';
import { apiPublic } from '@/lib/api';

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

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
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
            <p className="alert alert-info">Ordering opens in an upcoming release. You can follow the store to be ready.</p>
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
