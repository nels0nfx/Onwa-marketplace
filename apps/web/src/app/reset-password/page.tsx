import type { Metadata } from 'next';
import { Alert } from '@/components/ui/Alert';
import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { resolveMessage } from '@/lib/messages';
import { resetPasswordAction } from '../(auth)/actions';

export const metadata: Metadata = { title: 'Choose a new password' };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ e?: string; f?: string }> }) {
  const sp = await searchParams;
  const message = resolveMessage(sp.e, sp.f);
  return (
    <div className="container page-narrow stack-lg">
      <div className="page-head"><h1>Choose a new password</h1></div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <form action={resetPasswordAction} className="stack">
        <Field id="password" label="New password" type="password" autoComplete="new-password" required minLength={10} maxLength={72} hint="At least 10 characters with upper case, lower case and a number." />
        <Field id="confirmPassword" label="Confirm new password" type="password" autoComplete="new-password" required minLength={10} maxLength={72} />
        <SubmitButton block pendingText="Saving">Save password</SubmitButton>
      </form>
    </div>
  );
}
