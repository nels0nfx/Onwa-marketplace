import type { Metadata } from 'next';
import Link from 'next/link';
import { NG_STATES, type Address } from '@onwa/shared';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Field, SelectField } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { apiRequest } from '@/lib/api';
import { resolveMessage } from '@/lib/messages';
import { requireSession } from '@/lib/session';
import { deleteAddressAction, saveAddressAction } from './actions';

export const metadata: Metadata = { title: 'Delivery addresses' };
export const maxDuration = 45;

const STATE_OPTIONS = [{ value: '', label: 'Choose a state' }, ...NG_STATES.map((s) => ({ value: s, label: s }))];

function AddressForm({ address }: { address?: Address }) {
  return (
    <form action={saveAddressAction} className="stack">
      {address ? <input type="hidden" name="id" value={address.id} /> : null}
      <div className="form-grid cols-2">
        <Field id="label" label="Label" defaultValue={address?.label ?? 'Home'} maxLength={40} hint="For example Home or Office." />
        <Field id="recipientName" label="Recipient name" defaultValue={address?.recipientName} required maxLength={100} autoComplete="name" />
        <Field id="phone" label="Recipient phone" type="tel" defaultValue={address?.phone} required autoComplete="tel" />
        <Field id="line1" label="Street address" defaultValue={address?.line1} required maxLength={150} autoComplete="address-line1" />
        <Field id="line2" label="Address line 2 (optional)" defaultValue={address?.line2 ?? ''} maxLength={150} autoComplete="address-line2" />
        <Field id="city" label="City or town" defaultValue={address?.city} required maxLength={80} autoComplete="address-level2" />
        <Field id="lga" label="Local government area (LGA)" defaultValue={address?.lga} required maxLength={80} />
        <SelectField id="state" label="State" options={STATE_OPTIONS} defaultValue={address?.state ?? ''} required />
        <Field id="landmark" label="Nearest landmark (optional)" defaultValue={address?.landmark ?? ''} maxLength={150} />
        <Field id="postalCode" label="Postal code (optional)" defaultValue={address?.postalCode ?? ''} inputMode="numeric" maxLength={6} />
      </div>
      <label className="check"><input type="checkbox" name="isDefault" defaultChecked={address?.isDefault ?? false} /><span>Use as my default delivery address</span></label>
      <div><SubmitButton pendingText="Saving">{address ? 'Save address' : 'Add address'}</SubmitButton></div>
    </form>
  );
}

export default async function AddressesPage({ searchParams }: { searchParams: Promise<{ e?: string; f?: string; m?: string; edit?: string }> }) {
  const { token } = await requireSession('/account/addresses');
  const sp = await searchParams;
  const message = resolveMessage(sp.e ?? sp.m, sp.f);
  let addresses: Address[] = [];
  let failed = false;
  try {
    addresses = (await apiRequest<{ addresses: Address[] }>('/me/addresses', { token })).addresses;
  } catch {
    failed = true;
  }

  return (
    <div className="container page-medium stack-lg">
      <div className="page-head">
        <h1>Delivery addresses</h1>
        <p className="muted">Save up to 10 addresses. Your default is used first at checkout when ordering opens.</p>
        <p className="small"><Link href="/account">Back to your account</Link></p>
      </div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {failed ? <Alert tone="error">We could not load your addresses. Try again in a moment.</Alert> : null}

      {addresses.length > 0 ? (
        <ul className="list-plain">
          {addresses.map((a) => (
            <li key={a.id} className="item">
              <div className="item-head"><strong>{a.label}</strong>{a.isDefault ? <Badge staff>Default</Badge> : null}</div>
              <p>{a.recipientName}, {a.phone}</p>
              <p className="muted">{a.line1}{a.line2 ? `, ${a.line2}` : ''}, {a.city}, {a.lga}, {a.state}{a.postalCode ? ` ${a.postalCode}` : ''}{a.landmark ? ` (near ${a.landmark})` : ''}</p>
              <details>
                <summary className="small">Edit</summary>
                <div style={{ marginTop: 'var(--space-4)' }}><AddressForm address={a} /></div>
              </details>
              <form action={deleteAddressAction}>
                <input type="hidden" name="id" value={a.id} />
                <SubmitButton size="sm" variant="danger" pendingText="Deleting">Delete</SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      ) : !failed ? <p className="muted">You have no saved addresses yet.</p> : null}

      {addresses.length < 10 ? (
        <section className="card stack" aria-labelledby="add-title">
          <h2 id="add-title">Add an address</h2>
          <AddressForm />
        </section>
      ) : <p className="muted">You have reached the limit of 10 addresses. Delete one to add another.</p>}
    </div>
  );
}
