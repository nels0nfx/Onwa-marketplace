'use server';
import { redirect } from 'next/navigation';
import { ORDER_ACTIONS, orderActionSchema, uuidSchema } from '@onwa/shared';
import { apiRequest } from '@/lib/api';
import { str } from '@/lib/forms';
import { orderErrorCode } from '@/lib/orderCodes';
import { requireSession } from '@/lib/session';

const ALLOWED_BACK = ['/orders', '/seller/orders', '/admin/orders'];

/** One action for buyers, sellers and staff. The API and database decide who may do what. */
export async function orderAction(formData: FormData) {
  const back = str(formData.get('returnTo'));
  const target = ALLOWED_BACK.some((p) => back === p || back.startsWith(`${p}/`)) && !back.includes('?') && !back.includes('//') ? back : '/orders';
  const { token } = await requireSession(target);
  const id = uuidSchema.safeParse(str(formData.get('id')));
  const action = str(formData.get('action'));
  if (!id.success || !(ORDER_ACTIONS as readonly string[]).includes(action)) redirect(`${target}?e=not_found`);
  const parsed = orderActionSchema.safeParse({ action, note: str(formData.get('note')) });
  if (!id.success || !parsed.success) redirect(`${target}?e=validation&f=note`);
  if (!id.success || !parsed.success) return;
  try {
    await apiRequest(`/suborders/${id.data}/action`, { token, method: 'POST', body: parsed.data });
  } catch (e) {
    redirect(`${target}?e=${orderErrorCode(e)}`);
  }
  redirect(`${target}?m=order_status`);
}
