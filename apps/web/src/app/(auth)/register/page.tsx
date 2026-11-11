import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert } from '@/components/ui/Alert';
import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { resolveMessage } from '@/lib/messages';
import { registerAction } from '../actions';

export const metadata: Metadata = { title: 'Create account' };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ e?: string; f?: string }> }) {
  const sp = await searchParams;
  const message = resolveMessage(sp.e, sp.f);
  return (
    <div className="stack-lg">
      <div className="page-head"><h1>Create your account</h1><p className="muted">One account for buying products, downloads and services.</p></div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <form action={registerAction} className="stack">
        <Field id="fullName" label="Full name" autoComplete="name" required maxLength={100} />
        <Field id="email" label="Email" type="email" autoComplete="email" required />
        <Field id="password" label="Password" type="password" autoComplete="new-password" required minLength={10} maxLength={72} hint="At least 10 characters with upper case, lower case and a number." />
        <Field id="confirmPassword" label="Confirm password" type="password" autoComplete="new-password" required minLength={10} maxLength={72} />
        <label className="check"><input type="checkbox" name="acceptTerms" required /><span>I agree to the ONWA terms and privacy notice, and understand my data is handled under the Nigeria Data Protection Act 2023.</span></label>
        <SubmitButton block pendingText="Creating account">Create account</SubmitButton>
      </form>
      <p className="small muted">Already have an account? <Link href="/login">Sign in</Link></p>
    </div>
  );
}
