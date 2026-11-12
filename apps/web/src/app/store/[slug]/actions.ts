'use server';
import { redirect } from 'next/navigation';
import { storeSlugSchema } from '@onwa/shared';
import { apiRequest } from '@/lib/api';
import { requireSession } from '@/lib/session';

export async function toggleFollowAction(formData: FormData) {
  const slug = storeSlugSchema.safeParse(typeof formData.get('slug') === 'string' ? formData.get('slug') : '');
  if (!slug.success) redirect('/stores');
  const path = `/store/${slug.data}`;
  const { token } = await requireSession(path);
  const following = formData.get('following') === 'yes';
  try {
    await apiRequest(`/stores/${slug.data}/follow`, { token, method: following ? 'DELETE' : 'POST' });
  } catch {
    redirect(`${path}?e=service_error`);
  }
  redirect(path);
}
