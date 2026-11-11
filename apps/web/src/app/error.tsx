'use client';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="container page-narrow stack">
      <h1>Something went wrong</h1>
      <p className="muted">We could not load this page. Try again, and if it keeps happening, come back in a few minutes.</p>
      <div><button className="btn btn-primary" onClick={reset}>Try again</button></div>
    </div>
  );
}
