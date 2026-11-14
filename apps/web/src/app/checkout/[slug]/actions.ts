'use server';
import { redirect } from 'next/navigation';
import { checkoutSchema, storeSlugSchema } from '@onwa/shared';
import { apiRequest } from '@/lib/api';
import { str } from '@/lib/forms';
import { orderErrorCode } from '@/lib/orderCodes';
import { requireSession } from '@/lib/session';

export async function placeOrderAction(formData: FormData) {
  const slug = storeSlugSchema.safeParse(str(formData.get('storeSlug')));
  if (!slug.success) redirect('/cart?e=not_found');
  const path = `/checkout/${slug.data}`;
  const { token } = await requireSession(path);
  const parsed = checkoutSchema.safeParse({
    storeSlug: slug.data, addressId: str(formData.get('addressId')), note: str(formData.get('note')), idempotencyKey: str(formData.get('idempotencyKey')),
  });
  if (!parsed.success) redirect(`${path}?e=no_address`);

  let orderId = '';
  try {
    orderId = (await apiRequest<{ orderId: string }>('/checkout', { token, method: 'POST', body: parsed.data })).orderId;
  } catch (e) {
    redirect(`${path}?e=${orderErrorCode(e)}`);
  }
  redirect(`/orders/${orderId}?m=order_placed`);
}
