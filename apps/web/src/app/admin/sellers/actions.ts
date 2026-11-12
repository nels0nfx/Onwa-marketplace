'use server';
import { redirect } from 'next/navigation';
import { reviewDecisionSchema, sellerStatusChangeSchema, uuidSchema } from '@onwa/shared';
import { ApiError, apiRequest } from '@/lib/api';
import { firstIssueField } from '@/lib/messages';
import { requireSession } from '@/lib/session';

const str = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');

function errorCode(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403) return 'forbidden_action';
    if (e.status === 404) return 'not_found';
    if (e.status === 409) return 'conflict_action';
  }
  return 'service_error';
}

export async function decideApplicationAction(formData: FormData) {
  const id = uuidSchema.safeParse(str(formData.get('id')));
  if (!id.success) redirect('/admin/sellers?e=not_found');
  const path = `/admin/sellers/${id.data}`;
  const { token } = await requireSession(path);
  const parsed = reviewDecisionSchema.safeParse({ decision: str(formData.get('decision')), note: str(formData.get('note')) });
  if (!parsed.success) redirect(`${path}?e=validation&f=${firstIssueField(parsed.error.issues)}`);

  let result = 'decision_done';
  try {
    await apiRequest(`/admin/seller-applications/${id.data}/decision`, { token, method: 'POST', body: parsed.data });
  } catch (e) {
    result = errorCode(e);
  }
  redirect(`${path}?${result === 'decision_done' ? 'm' : 'e'}=${result}`);
}

export async function setSellerStatusAction(formData: FormData) {
  const { token } = await requireSession('/admin/sellers');
  const id = uuidSchema.safeParse(str(formData.get('id')));
  const parsed = sellerStatusChangeSchema.safeParse({ status: str(formData.get('status')), note: str(formData.get('note')) });
  if (!id.success) redirect('/admin/sellers?e=not_found');
  if (!parsed.success) redirect(`/admin/sellers?e=validation&f=${firstIssueField(parsed.error.issues)}`);

  let result = 'seller_status_done';
  try {
    await apiRequest(`/admin/sellers/${id.data}/status`, { token, method: 'POST', body: parsed.data });
  } catch (e) {
    result = errorCode(e);
  }
  redirect(`/admin/sellers?${result === 'seller_status_done' ? 'm' : 'e'}=${result}`);
}
