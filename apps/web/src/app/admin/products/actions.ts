'use server';
import { redirect } from 'next/navigation';
import { productDecisionSchema, uuidSchema } from '@onwa/shared';
import { ApiError, apiRequest } from '@/lib/api';
import { str } from '@/lib/forms';
import { firstIssueField } from '@/lib/messages';
import { requireSession } from '@/lib/session';

export async function decideProductAction(formData: FormData) {
  const id = uuidSchema.safeParse(str(formData.get('id')));
  if (!id.success) redirect('/admin/products?e=not_found');
  const path = `/admin/products/${id.data}`;
  const { token } = await requireSession(path);
  const parsed = productDecisionSchema.safeParse({ decision: str(formData.get('decision')), note: str(formData.get('note')) });
  if (!parsed.success) redirect(`${path}?e=validation&f=${firstIssueField(parsed.error.issues)}`);

  let result = 'decision_done';
  try {
    await apiRequest(`/admin/products/${id.data}/decision`, { token, method: 'POST', body: parsed.data });
  } catch (e) {
    result = e instanceof ApiError ? (e.status === 403 ? 'forbidden_action' : e.status === 404 ? 'not_found' : e.status === 409 ? 'conflict_action' : e.status === 400 ? 'not_ready' : 'service_error') : 'service_error';
  }
  redirect(`${path}?${result === 'decision_done' ? 'm' : 'e'}=${result}`);
}
