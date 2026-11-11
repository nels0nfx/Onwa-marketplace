import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert } from '@/components/ui/Alert';
import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { resolveMessage } from '@/lib/messages';
import { forgotPasswordAction } from '../actions';

export const metadata: Metadata = { title: 'Reset password' };

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ e?: string; f?: string; m?: string }> }) {
  const sp = await searchParams;
  const message = resolveMessage(sp.e ?? sp.m, sp.f);
  return (
    <div className="stack-lg">
      <div className="page-head"><h1>Reset your password</h1><p className="muted">Enter your email and we will send a reset link.</p></div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <form action={forgotPasswordAction} className="stack">
        <Field id="email" label="Email" type="email" autoComplete="email" required />
        <SubmitButton block pendingText="Sending">Send reset link</SubmitButton>
      </form>
      <p className="small"><Link href="/login">Back to sign in</Link></p>
    </div>
  );
}
