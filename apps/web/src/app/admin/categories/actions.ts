'use server';
import { redirect } from 'next/navigation';
import { categoryCreateSchema, categoryUpdateSchema, uuidSchema } from '@onwa/shared';
import { ApiError, apiRequest } from '@/lib/api';
import { intField, str } from '@/lib/forms';
import { firstIssueField } from '@/lib/messages';
import { requireSession } from '@/lib/session';

const PATH = '/admin/categories';
const fail = (e: unknown) => (e instanceof ApiError ? (e.status === 403 ? 'forbidden_action' : e.status === 404 ? 'not_found' : e.status === 409 ? 'conflict_action' : 'service_error') : 'service_error');

export async function createCategoryAction(formData: FormData) {
  const { token } = await requireSession(PATH);
  const parsed = categoryCreateSchema.safeParse({ name: str(formData.get('name')), parentId: str(formData.get('parentId')), sortOrder: intField(formData.get('sortOrder')) ?? 100 });
  if (!parsed.success) redirect(`${PATH}?e=validation&f=${firstIssueField(parsed.error.issues)}`);
  let result = 'category_saved';
  try {
    await apiRequest('/admin/categories', { token, method: 'POST', body: parsed.data });
  } catch (e) {
    result = fail(e);
  }
  redirect(`${PATH}?${result === 'category_saved' ? 'm' : 'e'}=${result}`);
}

export async function updateCategoryAction(formData: FormData) {
  const { token } = await requireSession(PATH);
  const id = uuidSchema.safeParse(str(formData.get('id')));
  if (!id.success) redirect(`${PATH}?e=not_found`);
  const parsed = categoryUpdateSchema.safeParse({ name: str(formData.get('name')), sortOrder: intField(formData.get('sortOrder')), isActive: formData.get('isActive') === 'on' });
  if (!parsed.success) redirect(`${PATH}?e=validation&f=${firstIssueField(parsed.error.issues)}`);
  let result = 'category_saved';
  try {
    await apiRequest(`/admin/categories/${id.data}`, { token, method: 'PUT', body: parsed.data });
  } catch (e) {
    result = fail(e);
  }
  redirect(`${PATH}?${result === 'category_saved' ? 'm' : 'e'}=${result}`);
}
