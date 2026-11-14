import type { Metadata } from 'next';
import Link from 'next/link';
import { formatNaira, type CartView } from '@onwa/shared';
import { Alert } from '@/components/ui/Alert';
import { ButtonLink } from '@/components/ui/Button';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { apiRequest } from '@/lib/api';
import { resolveMessage } from '@/lib/messages';
import { requireSession } from '@/lib/session';
import { removeCartItemAction, updateCartAction } from './actions';

export const metadata: Metadata = { title: 'Your cart' };
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

export default async function CartPage({ searchParams }: { searchParams: Promise<{ e?: string; m?: string }> }) {
  const { token } = await requireSession('/cart');
  const sp = await searchParams;
  const message = resolveMessage(sp.e ?? sp.m);
  let cart: CartView | null = null;
  try {
    cart = await apiRequest<CartView>('/cart', { token });
  } catch {
    cart = null;
  }

  return (
    <div className="container page-medium stack-lg">
      <div className="page-head"><h1>Your cart</h1><p className="muted">Each store is checked out separately.</p></div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {!cart ? <Alert tone="error">We could not load your cart. Try again in a moment.</Alert> : null}
      {cart && cart.groups.length === 0 ? <div className="stack"><p className="muted">Your cart is empty.</p><div><ButtonLink href="/products">Browse products</ButtonLink></div></div> : null}

      {(cart?.groups ?? []).map((g) => (
        <section key={g.sellerId} className="card stack" aria-labelledby={`store-${g.sellerId}`}>
          <h2 id={`store-${g.sellerId}`} style={{ fontSize: '1.5rem' }}><Link href={`/store/${g.store.slug}`}>{g.store.name}</Link></h2>
          <ul className="list-plain">
            {g.items.map((i) => (
              <li key={i.id} className="item">
                <div className="row">
                  {i.imageUrl ? <img className="logo-sm" src={i.imageUrl} alt="" /> : <span className="logo-sm" aria-hidden="true">{i.productName.slice(0, 1)}</span>}
                  <div className="stack" style={{ gap: 'var(--space-1)' }}>
                    <Link href={`/product/${i.productSlug}`}><strong>{i.productName}</strong></Link>
                    <span className="muted small">{i.variantLabel}</span>
                    <span className="price">{formatNaira(i.unitPriceKobo)}{i.unitPriceKobo < i.listPriceKobo ? <s>{formatNaira(i.listPriceKobo)}</s> : null}</span>
                  </div>
                </div>
                {i.problem ? <p className="alert alert-error" role="alert">{i.problem}</p> : null}
                <div className="row">
                  <form action={updateCartAction} className="row">
                    <input type="hidden" name="itemId" value={i.id} />
                    <label className="visually-hidden" htmlFor={`qty-${i.id}`}>Quantity</label>
                    <input id={`qty-${i.id}`} name="quantity" className="input" style={{ width: '5.5rem' }} type="number" min={1} max={Math.max(1, i.maxQuantity)} defaultValue={i.quantity} />
                    <SubmitButton size="sm" variant="secondary" pendingText="Updating">Update</SubmitButton>
                  </form>
                  <form action={removeCartItemAction}><input type="hidden" name="itemId" value={i.id} /><SubmitButton size="sm" variant="danger" pendingText="Removing">Remove</SubmitButton></form>
                  <strong style={{ marginLeft: 'auto' }}>{formatNaira(i.lineTotalKobo)}</strong>
                </div>
              </li>
            ))}
          </ul>
          <div className="item-head"><span className="muted">Subtotal</span><strong>{formatNaira(g.subtotalKobo)}</strong></div>
          {g.checkoutReady
            ? <div><ButtonLink href={`/checkout/${g.store.slug}`}>Checkout with {g.store.name}</ButtonLink></div>
            : <p className="muted small">Fix the items marked above to continue.</p>}
        </section>
      ))}
    </div>
  );
}
