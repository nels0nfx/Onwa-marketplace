import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { storeSlugSchema, type Paged, type PublicProductCard, type PublicStore } from '@onwa/shared';
import { ProductCard } from '@/components/catalog/ProductCard';
import { Alert } from '@/components/ui/Alert';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { apiPublic, apiRequest } from '@/lib/api';
import { resolveMessage } from '@/lib/messages';
import { getSessionToken } from '@/lib/session';
import { toggleFollowAction } from './actions';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

async function loadStore(slug: string): Promise<PublicStore | null> {
  if (!storeSlugSchema.safeParse(slug).success) return null;
  return (await apiPublic<{ store: PublicStore }>(`/stores/${slug}`))?.store ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  try {
    const store = await loadStore(slug);
    return store ? { title: store.name, description: store.tagline ?? `Shop ${store.name} on ONWA` } : { title: 'Store not found' };
  } catch {
    return { title: 'Store' };
  }
}

export default async function StorePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ e?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const store = await loadStore(slug);
  if (!store) notFound();

  let following = false;
  const session = await getSessionToken();
  if (session) {
    try {
      following = (await apiRequest<{ slugs: string[] }>('/me/follows', { token: session.token })).slugs.includes(store.slug);
    } catch {
      following = false;
    }
  }
  const message = resolveMessage(sp.e);
  let products: Paged<PublicProductCard> | null = null;
  try {
    products = await apiPublic<Paged<PublicProductCard>>(`/products?store=${store.slug}&limit=12`);
  } catch {
    products = null;
  }

  return (
    <div data-accent={store.accent}>
      <div className="container">
        <div className="store-cover" style={store.coverUrl ? { backgroundImage: `url("${store.coverUrl}")` } : undefined} role="img" aria-label={store.coverUrl ? `${store.name} cover image` : undefined} />
        <div className="store-head">
          {store.logoUrl ? <img className="logo-lg" src={store.logoUrl} alt={`${store.name} logo`} /> : <span className="logo-lg" aria-hidden="true">{store.name.slice(0, 1)}</span>}
          <div className="stack">
            <h1>{store.name}</h1>
            {store.tagline ? <p className="muted">{store.tagline}</p> : null}
            <div className="row">
              <span className="verified">✓ Verified seller</span>
              <span className="muted small">{store.followers} {store.followers === 1 ? 'follower' : 'followers'}</span>
              <span className="muted small">On ONWA since {new Date(store.since).toLocaleDateString('en-NG', { month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' })}</span>
            </div>
            <form action={toggleFollowAction}>
              <input type="hidden" name="slug" value={store.slug} />
              <input type="hidden" name="following" value={following ? 'yes' : 'no'} />
              <SubmitButton variant={following ? 'secondary' : 'primary'} pendingText="Updating">{following ? 'Following' : 'Follow store'}</SubmitButton>
            </form>
          </div>
        </div>
      </div>

      <div className="container page-wide stack-lg">
        {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
        <section className="stack" aria-labelledby="listings-title">
          <h2 id="listings-title">Listings</h2>
          {products && products.rows.length > 0 ? (
            <>
              <div className="product-grid">{products.rows.map((p) => <ProductCard key={p.slug} product={p} />)}</div>
              {products.total > products.rows.length ? <p><Link href={`/products?store=${store.slug}`}>See all {products.total} products</Link></p> : null}
            </>
          ) : <p className="muted">This store has no products yet. Digital items and services arrive in upcoming releases.</p>}
        </section>
        {store.description ? <section className="stack" aria-labelledby="about-title"><h2 id="about-title">About</h2><p className="prose">{store.description}</p></section> : null}
        {store.deliveryInfo ? <section className="stack" aria-labelledby="delivery-title"><h2 id="delivery-title">Delivery information</h2><p className="prose">{store.deliveryInfo}</p></section> : null}
        {store.policies ? <section className="stack" aria-labelledby="policies-title"><h2 id="policies-title">Store policies</h2><p className="prose">{store.policies}</p></section> : null}
        <p className="small"><Link href="/stores">All stores</Link></p>
      </div>
    </div>
  );
}
