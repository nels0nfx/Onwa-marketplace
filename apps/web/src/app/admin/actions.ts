'use server';
import { redirect } from 'next/navigation';
import { isRoleCode, safeRedirectPath, uuidSchema } from '@onwa/shared';
import { ApiError, apiRequest } from '@/lib/api';
import { requireSession } from '@/lib/session';

const str = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');

function adminReturn(formData: FormData): string {
  const p = safeRedirectPath(str(formData.get('returnTo')), '/admin');
  return p.startsWith('/admin') ? p : '/admin';
}

function withParam(path: string, key: 'm' | 'e', value: string): string {
  const url = new URL(path, 'http://local');
  url.searchParams.delete('m'); url.searchParams.delete('e');
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

function errorCode(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403) return 'forbidden_action';
    if (e.status === 404) return 'not_found';
    if (e.status === 409) return 'conflict_action';
  }
  return 'service_error';
}

async function changeRole(formData: FormData, method: 'POST' | 'DELETE') {
  const { token } = await requireSession('/admin');
  const returnTo = adminReturn(formData);
  const userId = uuidSchema.safeParse(str(formData.get('userId')));
  const role = str(formData.get('role'));
  if (!userId.success || !isRoleCode(role)) redirect(withParam(returnTo, 'e', 'service_error'));

  let result: string;
  try {
    await apiRequest(method === 'POST' ? `/admin/users/${userId.data}/roles` : `/admin/users/${userId.data}/roles/${role}`, {
      token, method, ...(method === 'POST' ? { body: { role } } : {}),
    });
    result = method === 'POST' ? 'role_granted' : 'role_revoked';
  } catch (e) {
    redirect(withParam(returnTo, 'e', errorCode(e)));
  }
  redirect(withParam(returnTo, 'm', result));
}

export async function assignRoleAction(formData: FormData) { await changeRole(formData, 'POST'); }
export async function revokeRoleAction(formData: FormData) { await changeRole(formData, 'DELETE'); }
