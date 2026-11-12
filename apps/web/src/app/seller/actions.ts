'use server';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import {
  EXTENSION_BY_TYPE, IMAGE_TYPES, MAX_COVER_BYTES, MAX_LOGO_BYTES, MIME_BY_TYPE, storeProfileSchema, type StoreProfile,
} from '@onwa/shared';
import { ApiError, apiRequest } from '@/lib/api';
import { firstIssueField } from '@/lib/messages';
import { requireSession } from '@/lib/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { checkUpload } from '@/lib/uploads';

const PATH = '/seller';
const str = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');

export async function saveStoreAction(formData: FormData) {
  const { token } = await requireSession(PATH);
  const parsed = storeProfileSchema.safeParse({
    name: str(formData.get('name')), tagline: str(formData.get('tagline')), description: str(formData.get('description')),
    policies: str(formData.get('policies')), deliveryInfo: str(formData.get('deliveryInfo')), accent: str(formData.get('accent')),
  });
  if (!parsed.success) redirect(`${PATH}?e=validation&f=${firstIssueField(parsed.error.issues)}`);
  let result = 'store_saved';
  try {
    await apiRequest('/seller/store', { token, method: 'PUT', body: parsed.data });
  } catch (e) {
    result = e instanceof ApiError && e.status === 403 ? 'forbidden_action' : 'service_error';
  }
  redirect(`${PATH}?${result === 'store_saved' ? 'm' : 'e'}=${result}`);
}

export async function uploadStoreMediaAction(formData: FormData) {
  const { token } = await requireSession(PATH);
  const kind = str(formData.get('kind')) === 'cover' ? 'cover' : 'logo';
  const file = await checkUpload(formData.get('file'), IMAGE_TYPES, kind === 'logo' ? MAX_LOGO_BYTES : MAX_COVER_BYTES);
  if (!file.ok) redirect(`${PATH}?e=${file.code}`);

  let result = 'media_saved';
  try {
    const { store } = await apiRequest<{ store: StoreProfile }>('/seller/store', { token });
    if (store.sellerStatus !== 'active') {
      result = 'forbidden_action';
    } else {
      const path = `${store.sellerId}/${kind}-${randomUUID()}.${EXTENSION_BY_TYPE[file.type]}`;
      const supabase = await createSupabaseServerClient();
      const up = await supabase.storage.from('store-media').upload(path, file.bytes, { contentType: MIME_BY_TYPE[file.type], upsert: false });
      if (up.error) {
        result = 'upload_failed';
      } else {
        try {
          await apiRequest('/seller/store/media', { token, method: 'POST', body: { kind, path } });
        } catch {
          await supabase.storage.from('store-media').remove([path]);
          result = 'upload_failed';
        }
      }
    }
  } catch {
    result = 'service_error';
  }
  redirect(`${PATH}?${result === 'media_saved' ? 'm' : 'e'}=${result}`);
}
