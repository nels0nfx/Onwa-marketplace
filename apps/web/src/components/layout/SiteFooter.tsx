export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container footer-inner">
        <strong>ONWA Unified Marketplace</strong>
        <p className="muted small">One marketplace. Endless possibilities.</p>
        <p className="muted small">© {new Date().getFullYear()} ONWA. All rights reserved.</p>
      </div>
    </footer>
  );
}
