import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { formatNaira, storeSlugSchema, type Address, type CartView } from '@onwa/shared';
import { Alert } from '@/components/ui/Alert';
import { ButtonLink } from '@/components/ui/Button';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { apiRequest } from '@/lib/api';
import { resolveMessage } from '@/lib/messages';
import { requireSession } from '@/lib/session';
import { placeOrderAction } from './actions';

export const metadata: Metadata = { title: 'Checkout' };
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

export default async function CheckoutPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ e?: string }> }) {
  const { slug } = await params;
  if (!storeSlugSchema.safeParse(slug).success) redirect('/cart');
  const { token } = await requireSession(`/checkout/${slug}`);
  const sp = await searchParams;
  const message = resolveMessage(sp.e);

  let cart: CartView;
  let addresses: Address[];
  try {
    cart = await apiRequest<CartView>('/cart', { token });
    addresses = (await apiRequest<{ addresses: Address[] }>('/me/addresses', { token })).addresses;
  } catch {
    return <div className="container page-medium stack"><h1>Checkout</h1><Alert tone="error">We could not load your checkout. Try again in a moment.</Alert></div>;
  }
  const group = cart.groups.find((g) => g.store.slug === slug);
  if (!group) redirect('/cart');
  const idempotencyKey = randomUUID(); // one key per page view: a double-tap on "Place order" cannot create two orders

  return (
    <div className="container page-medium stack-lg">
      <div className="page-head"><h1>Checkout</h1><p className="muted">Ordering from <Link href={`/store/${group.store.slug}`}>{group.store.name}</Link></p></div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {!group.checkoutReady ? <Alert tone="error">Some items need attention. <Link href="/cart">Back to your cart</Link> to fix them.</Alert> : null}

      <section className="card stack" aria-labelledby="items-title">
        <h2 id="items-title">Your items</h2>
        <ul className="list-plain">
          {group.items.map((i) => (
            <li key={i.id} className="item-head"><span>{i.quantity} × {i.productName} <span className="muted small">({i.variantLabel})</span></span><strong>{formatNaira(i.lineTotalKobo)}</strong></li>
          ))}
        </ul>
        <dl className="kv">
          <div><dt>Subtotal</dt><dd>{formatNaira(group.subtotalKobo)}</dd></div>
          <div><dt>Delivery</dt><dd>{formatNaira(0)} for now. Delivery pricing is added in an upcoming release.</dd></div>
          <div><dt>Total</dt><dd><strong>{formatNaira(group.subtotalKobo)}</strong></dd></div>
        </dl>
      </section>

      <form action={placeOrderAction} className="stack-lg">
        <input type="hidden" name="storeSlug" value={slug} />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <fieldset className="stack"><legend>Delivery address</legend>
          {addresses.length === 0 ? (
            <div className="stack"><p className="muted">You have no saved addresses.</p><div><ButtonLink href="/account/addresses" variant="secondary">Add an address</ButtonLink></div></div>
          ) : (
            <>
              {addresses.map((a, idx) => (
                <label key={a.id} className="check">
                  <input type="radio" name="addressId" value={a.id} defaultChecked={a.isDefault || (idx === 0 && !addresses.some((x) => x.isDefault))} required />
                  <span><strong>{a.label}</strong>: {a.recipientName}, {a.phone}<br /><span className="muted small">{a.line1}{a.line2 ? `, ${a.line2}` : ''}, {a.city}, {a.lga}, {a.state}</span></span>
                </label>
              ))}
              <p className="small"><Link href="/account/addresses">Add or edit addresses</Link></p>
            </>
          )}
        </fieldset>
        <div className="field"><label htmlFor="note">Note to the seller (optional)</label><textarea id="note" name="note" className="input textarea" maxLength={300} rows={2} /></div>
        <p className="alert alert-info">Placing the order reserves your items for 30 minutes. Online payment opens in an upcoming release, so this order will wait for payment until then.</p>
        {group.checkoutReady && addresses.length > 0 ? <div><SubmitButton pendingText="Placing order">Place order</SubmitButton></div> : null}
      </form>
    </div>
  );
}
