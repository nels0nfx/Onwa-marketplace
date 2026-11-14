import Link from 'next/link';
import { signOutAction } from '@/app/actions';
import { ButtonLink } from '@/components/ui/Button';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ThemeToggle } from './ThemeToggle';

export async function SiteHeader() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link href="/" className="wordmark" aria-label="ONWA home">ONWA</Link>
        <nav className="header-actions" aria-label="Account">
          <ThemeToggle />
          {user ? (
            <>
              <Link className="nav-link" href="/cart">Cart</Link>
              <Link className="nav-link" href="/account">Account</Link>
              <form action={signOutAction}><button className="btn btn-ghost btn-sm" type="submit">Sign out</button></form>
            </>
          ) : (
            <>
              <Link className="nav-link" href="/login">Sign in</Link>
              <ButtonLink href="/register" size="sm">Create account</ButtonLink>
            </>
          )}
        </nav>
      </div>
      <nav className="subnav" aria-label="Marketplace">
        <div className="container subnav-inner">
          <Link href="/products">Products</Link>
          <Link href="/stores">Stores</Link>
          <Link href="/sell">Become a seller</Link>
        </div>
      </nav>
    </header>
  );
}
