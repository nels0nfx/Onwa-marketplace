import Link from 'next/link';
import { formatNaira, type PublicProductCard } from '@onwa/shared';

export function ProductCard({ product }: { product: PublicProductCard }) {
  return (
    <Link href={`/product/${product.slug}`} className="product-card">
      {product.imageUrl ? <img className="product-img" src={product.imageUrl} alt="" loading="lazy" /> : <span className="product-img product-img-empty" aria-hidden="true">{product.name.slice(0, 1)}</span>}
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <strong>{product.name}</strong>
        {product.brand ? <span className="muted small">{product.brand}</span> : null}
        <span className="price">{product.priceFromKobo !== null ? formatNaira(product.priceFromKobo) : 'Price on request'}{product.hasSale ? <span className="badge badge-staff" style={{ marginLeft: 'var(--space-2)' }}>Sale</span> : null}</span>
        {!product.inStock ? <span className="muted small">Out of stock</span> : null}
        <span className="muted small">{product.storeName}</span>
      </div>
    </Link>
  );
}
