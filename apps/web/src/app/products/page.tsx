import type { Metadata } from 'next';
import Link from 'next/link';
import { PRODUCT_CONDITIONS, browseProductsQuerySchema, nairaToKobo, koboToNairaInput, type Paged, type PublicProductCard } from '@onwa/shared';
import { Alert } from '@/components/ui/Alert';
import { ProductCard } from '@/components/catalog/ProductCard';
import { apiPublic } from '@/lib/api';
import { loadCategories } from '@/lib/catalogData';

export const metadata: Metadata = { title: 'Products' };
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

type SP = Record<string, string | undefined>;

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const min = sp.min ? nairaToKobo(sp.min) : null;
  const max = sp.max ? nairaToKobo(sp.max) : null;
  const parsed = browseProductsQuerySchema.safeParse({
    q: sp.q || undefined, category: sp.category || undefined, store: sp.store || undefined, condition: sp.condition || undefined,
    minPriceKobo: min ?? undefined, maxPriceKobo: max ?? undefined, inStock: sp.inStock || undefined, sort: sp.sort || undefined, offset: sp.offset,
  });
  const query = parsed.success ? parsed.data : browseProductsQuerySchema.parse({});
  const { tree } = await loadCategories();

  let data: Paged<PublicProductCard> | null = null;
  let failed = false;
  try {
    const params = new URLSearchParams({ limit: String(query.limit), offset: String(query.offset), sort: query.sort });
    if (query.q) params.set('q', query.q);
    if (query.category) params.set('category', query.category);
    if (query.store) params.set('store', query.store);
    if (query.condition) params.set('condition', query.condition);
    if (query.minPriceKobo !== undefined) params.set('minPriceKobo', String(query.minPriceKobo));
    if (query.maxPriceKobo !== undefined) params.set('maxPriceKobo', String(query.maxPriceKobo));
    if (query.inStock) params.set('inStock', '1');
    data = await apiPublic<Paged<PublicProductCard>>(`/products?${params}`);
  } catch {
    failed = true;
  }

  const keep = (o: number) => {
    const p = new URLSearchParams();
    for (const k of ['q', 'category', 'store', 'condition', 'min', 'max', 'inStock', 'sort']) if (sp[k]) p.set(k, sp[k] as string);
    p.set('offset', String(Math.max(0, o)));
    return `/products?${p}`;
  };

  return (
    <div className="container page-wide stack-lg">
      <div className="page-head"><h1>Products</h1><p className="muted">Physical goods from independent Nigerian sellers.</p></div>

      <form method="get" className="filters" role="search">
        <div className="field"><label htmlFor="q">Search</label><input id="q" name="q" className="input" defaultValue={query.q ?? ''} maxLength={64} placeholder="Name or brand" /></div>
        <div className="field"><label htmlFor="category">Category</label>
          <select id="category" name="category" className="select" defaultValue={query.category ?? ''}>
            <option value="">All categories</option>
            {tree.map((c) => (<optgroup key={c.id} label={c.name}><option value={c.slug}>All {c.name}</option>{c.children.map((k) => <option key={k.id} value={k.slug}>{k.name}</option>)}</optgroup>))}
          </select></div>
        <div className="field"><label htmlFor="condition">Condition</label>
          <select id="condition" name="condition" className="select" defaultValue={query.condition ?? ''}>
            <option value="">Any</option>{PRODUCT_CONDITIONS.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
          </select></div>
        <div className="field"><label htmlFor="sort">Sort by</label>
          <select id="sort" name="sort" className="select" defaultValue={query.sort}>
            <option value="newest">Newest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option>
          </select></div>
        <div className="field"><label htmlFor="min">Min price (₦)</label><input id="min" name="min" className="input" inputMode="decimal" defaultValue={query.minPriceKobo !== undefined ? koboToNairaInput(query.minPriceKobo) : sp.min ?? ''} /></div>
        <div className="field"><label htmlFor="max">Max price (₦)</label><input id="max" name="max" className="input" inputMode="decimal" defaultValue={query.maxPriceKobo !== undefined ? koboToNairaInput(query.maxPriceKobo) : sp.max ?? ''} /></div>
        <label className="check"><input type="checkbox" name="inStock" value="1" defaultChecked={query.inStock} /><span>In stock only</span></label>
        <div><button className="btn btn-primary" type="submit">Apply</button> <Link className="nav-link" href="/products">Clear</Link></div>
      </form>

      {failed ? <Alert tone="error">We could not load products right now. Try again in a moment.</Alert> : null}
      {data && data.rows.length === 0 ? <p className="muted">No products match. Try clearing a filter.</p> : null}
      {data && data.rows.length > 0 ? <div className="product-grid">{data.rows.map((p) => <ProductCard key={p.slug} product={p} />)}</div> : null}
      {data ? (
        <div className="pager">
          {query.offset > 0 ? <Link href={keep(query.offset - query.limit)}>Previous</Link> : <span />}
          {query.offset + query.limit < data.total ? <Link href={keep(query.offset + query.limit)}>Next</Link> : <span />}
        </div>
      ) : null}
    </div>
  );
}
