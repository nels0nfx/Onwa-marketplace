'use server';
import { redirect } from 'next/navigation';
import { addressSchema, uuidSchema } from '@onwa/shared';
import { ApiError, apiRequest } from '@/lib/api';
import { firstIssueField } from '@/lib/messages';
import { requireSession } from '@/lib/session';

const str = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');
const PATH = '/account/addresses';

export async function saveAddressAction(formData: FormData) {
  const { token } = await requireSession(PATH);
  const id = str(formData.get('id'));
  const parsed = addressSchema.safeParse({
    label: str(formData.get('label')), recipientName: str(formData.get('recipientName')), phone: str(formData.get('phone')),
    line1: str(formData.get('line1')), line2: str(formData.get('line2')), city: str(formData.get('city')), lga: str(formData.get('lga')),
    state: str(formData.get('state')), landmark: str(formData.get('landmark')), postalCode: str(formData.get('postalCode')),
    isDefault: formData.get('isDefault') === 'on',
  });
  if (!parsed.success) redirect(`${PATH}?e=validation&f=${firstIssueField(parsed.error.issues)}${id ? `&edit=${encodeURIComponent(id)}` : ''}`);

  let result = 'address_saved';
  try {
    if (id) {
      const ok = uuidSchema.safeParse(id);
      if (!ok.success) result = 'not_found';
      else await apiRequest(`/me/addresses/${ok.data}`, { token, method: 'PUT', body: parsed.data });
    } else {
      await apiRequest('/me/addresses', { token, method: 'POST', body: parsed.data });
    }
  } catch (e) {
    result = e instanceof ApiError && e.status === 409 ? 'conflict_action' : e instanceof ApiError && e.status === 404 ? 'not_found' : 'service_error';
  }
  redirect(`${PATH}?${result === 'address_saved' ? 'm' : 'e'}=${result}`);
}

export async function deleteAddressAction(formData: FormData) {
  const { token } = await requireSession(PATH);
  const id = uuidSchema.safeParse(str(formData.get('id')));
  let result = 'address_deleted';
  if (!id.success) result = 'not_found';
  else {
    try {
      await apiRequest(`/me/addresses/${id.data}`, { token, method: 'DELETE' });
    } catch (e) {
      result = e instanceof ApiError && e.status === 404 ? 'not_found' : 'service_error';
    }
  }
  redirect(`${PATH}?${result === 'address_deleted' ? 'm' : 'e'}=${result}`);
}
