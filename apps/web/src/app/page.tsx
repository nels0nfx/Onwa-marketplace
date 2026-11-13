import { ButtonLink } from '@/components/ui/Button';

export default function HomePage() {
  return (
    <div className="container">
      <section className="hero" aria-labelledby="hero-title">
        <h1 id="hero-title"><span>One marketplace.</span><span>Endless possibilities.</span></h1>
        <p className="lead">Physical products, digital downloads and professional services from independent Nigerian sellers, all in one place with one account.</p>
        <div className="actions">
          <ButtonLink href="/register">Create your account</ButtonLink>
          <ButtonLink href="/products" variant="secondary">Browse products</ButtonLink>
        </div>
      </section>

      <section aria-labelledby="ways-title" className="stack-lg">
        <h2 id="ways-title">Three ways to buy, one checkout</h2>
        <div className="directory">
          <article><h3>Products</h3><p>Physical goods from independent sellers, delivered across Nigeria. <a href="/products">Browse now</a>.</p></article>
          <article><h3>Digital</h3><p>Downloads that unlock as soon as your payment is confirmed.</p></article>
          <article><h3>Services</h3><p>Book professionals by the hour, by package or by quote.</p></article>
        </div>
      </section>

      <section className="opening" aria-labelledby="opening-title">
        <div className="stack">
          <h2 id="opening-title">ONWA is opening soon</h2>
          <p className="muted">Create your account now so it is ready on opening day.</p>
        </div>
        <ButtonLink href="/register">Create account</ButtonLink>
      </section>
    </div>
  );
}
