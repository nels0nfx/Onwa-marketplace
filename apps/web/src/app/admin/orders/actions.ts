'use server';
import { redirect } from 'next/navigation';
import { ApiError, apiRequest } from '@/lib/api';
import { requireSession } from '@/lib/session';

export async function sweepExpiredAction() {
  const { token } = await requireSession('/admin/orders');
  let result = 'expired_done';
  try {
    await apiRequest('/admin/orders/expire-unpaid', { token, method: 'POST' });
  } catch (e) {
    result = e instanceof ApiError && e.status === 403 ? 'forbidden_action' : 'service_error';
  }
  redirect(`/admin/orders?${result === 'expired_done' ? 'm' : 'e'}=${result}`);
}
