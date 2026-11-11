import type { Metadata } from 'next';
import Link from 'next/link';
import { safeRedirectPath } from '@onwa/shared';
import { Alert } from '@/components/ui/Alert';
import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { resolveMessage } from '@/lib/messages';
import { loginAction } from '../actions';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ e?: string; f?: string; m?: string; next?: string }> }) {
  const sp = await searchParams;
  const message = resolveMessage(sp.e ?? sp.m, sp.f);
  return (
    <div className="stack-lg">
      <div className="page-head"><h1>Sign in</h1><p className="muted">Welcome back to ONWA.</p></div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <form action={loginAction} className="stack">
        <input type="hidden" name="next" value={safeRedirectPath(sp.next)} />
        <Field id="email" label="Email" type="email" autoComplete="email" required />
        <Field id="password" label="Password" type="password" autoComplete="current-password" required />
        <SubmitButton block pendingText="Signing in">Sign in</SubmitButton>
      </form>
      <p className="small"><Link href="/forgot-password">Forgot your password?</Link></p>
      <p className="small muted">New to ONWA? <Link href="/register">Create an account</Link></p>
    </div>
  );
}
