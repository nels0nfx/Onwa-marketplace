'use server';
import { redirect } from 'next/navigation';
import { profileUpdateSchema, type MeResponse } from '@onwa/shared';
import { ApiError, apiRequest } from '@/lib/api';
import { firstIssueField } from '@/lib/messages';
import { requireSession } from '@/lib/session';

const str = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');

export async function updateProfileAction(formData: FormData) {
  const { token } = await requireSession('/account');
  const parsed = profileUpdateSchema.safeParse({ fullName: str(formData.get('fullName')), phone: str(formData.get('phone')) });
  if (!parsed.success) redirect(`/account?e=validation&f=${firstIssueField(parsed.error.issues)}`);
  let outcome = 'profile_saved';
  try {
    await apiRequest<MeResponse>('/me', { token, method: 'PATCH', body: parsed.data });
  } catch (e) {
    outcome = e instanceof ApiError && e.status === 400 ? 'validation' : 'service_error';
  }
  redirect(outcome === 'validation' ? '/account?e=validation&f=fullName' : `/account?${outcome === 'profile_saved' ? 'm' : 'e'}=${outcome}`);
}
