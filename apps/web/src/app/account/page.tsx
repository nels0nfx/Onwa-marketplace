import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ROLE_DEFINITIONS } from '@onwa/shared';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { resolveMessage } from '@/lib/messages';
import { loadMe, requireSession } from '@/lib/session';
import { updateProfileAction } from './actions';

export const metadata: Metadata = { title: 'Your account' };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ e?: string; f?: string; m?: string }> }) {
  const { token } = await requireSession('/account');
  const { me, apiDown, status } = await loadMe(token);
  const sp = await searchParams;
  const message = resolveMessage(sp.e ?? sp.m, sp.f);

  if (apiDown) {
    return (
      <div className="container page-medium stack">
        <h1>Your account</h1>
        <Alert tone="error">We could not load your account right now. Try again in a moment.</Alert>
      </div>
    );
  }
  if (!me) redirect('/login?e=callback_failed');

  const canAdmin = me.permissions.includes('admin.access');
  return (
    <div className="container page-medium stack-lg">
      <div className="page-head">
        <h1>{me.profile.fullName ? `Hello, ${me.profile.fullName.split(' ')[0]}` : 'Your account'}</h1>
        <p className="muted">Manage your details. Orders, addresses and saved items will appear here as ONWA opens up.</p>
      </div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}

      <section className="card stack" aria-labelledby="profile-title">
        <h2 id="profile-title">Profile</h2>
        <form action={updateProfileAction} className="stack">
          <Field id="fullName" label="Full name" defaultValue={me.profile.fullName} required maxLength={100} autoComplete="name" />
          <Field id="phone" label="Phone" type="tel" defaultValue={me.profile.phone ?? ''} autoComplete="tel" hint="Nigerian numbers like 0803 123 4567 are saved in international format." />
          <div className="field"><label htmlFor="email-ro">Email</label><input id="email-ro" className="input" value={me.profile.email} readOnly /><p className="hint">Your sign-in email cannot be changed here yet.</p></div>
          <div><SubmitButton pendingText="Saving">Save changes</SubmitButton></div>
        </form>
      </section>

      <section className="card stack" aria-labelledby="access-title">
        <h2 id="access-title">Access</h2>
        <div className="row">
          {me.roles.map((r) => <Badge key={r} staff={ROLE_DEFINITIONS[r].isStaff}>{ROLE_DEFINITIONS[r].name}</Badge>)}
        </div>
        {canAdmin ? <div><ButtonLink href="/admin" variant="secondary">Open administration</ButtonLink></div> : null}
      </section>

      <p className="small muted"><Link href="/forgot-password">Change password</Link></p>
    </div>
  );
}
