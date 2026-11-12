import type { Metadata } from 'next';
import { ButtonLink } from '@/components/ui/Button';
import { getSessionToken } from '@/lib/session';

export const metadata: Metadata = { title: 'Become a seller' };

export default async function SellPage() {
  const session = await getSessionToken();
  return (
    <div className="container page-medium stack-lg">
      <div className="page-head">
        <h1>Sell on ONWA</h1>
        <p className="muted">Open your own storefront for products, digital downloads or services, and reach customers across Nigeria.</p>
      </div>

      <section className="stack" aria-labelledby="steps-title">
        <h2 id="steps-title">How it works</h2>
        <ol className="list-plain">
          <li className="item"><strong>1. Apply</strong><p className="muted">Tell us about you and your business, upload an identity document and add the bank account where you want to be paid.</p></li>
          <li className="item"><strong>2. We review</strong><p className="muted">A member of our team checks your application. We may ask for more information, and you can follow the status on your application page.</p></li>
          <li className="item"><strong>3. Your store opens</strong><p className="muted">Once approved you get a public storefront and a seller dashboard. Approval opens your store; each listing you add may also be reviewed.</p></li>
        </ol>
      </section>

      <section className="card stack" aria-labelledby="who-title">
        <h2 id="who-title">Who can apply</h2>
        <p>Individuals and registered businesses can both apply. A CAC registration is not required for every seller, so upload it only if you have one.</p>
        <p className="muted small">You will need a valid identity document and a Nigerian bank account in your own or your business's name. Your documents are stored privately and seen only by our review team.</p>
      </section>

      <div className="row">
        {session ? <ButtonLink href="/sell/apply">Start or continue your application</ButtonLink> : (
          <>
            <ButtonLink href="/register">Create an account to apply</ButtonLink>
            <ButtonLink href="/login?next=%2Fsell%2Fapply" variant="secondary">Sign in</ButtonLink>
          </>
        )}
      </div>
    </div>
  );
}
