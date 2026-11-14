'use server';
import { redirect } from 'next/navigation';
import { addToCartSchema, cartQuantitySchema, uuidSchema } from '@onwa/shared';
import { apiRequest } from '@/lib/api';
import { intField, str } from '@/lib/forms';
import { orderErrorCode } from '@/lib/orderCodes';
import { requireSession } from '@/lib/session';

function safeBack(formData: FormData, fallback: string): string {
  const p = str(formData.get('returnTo'));
  return p.startsWith('/product/') || p.startsWith('/cart') ? p : fallback;
}
const go = (path: string, kind: 'm' | 'e', code: string) => redirect(`${path}${path.includes('?') ? '&' : '?'}${kind}=${code}`);

export async function addToCartAction(formData: FormData) {
  const back = safeBack(formData, '/cart');
  const { token } = await requireSession(back);
  const parsed = addToCartSchema.safeParse({ variantId: str(formData.get('variantId')), quantity: intField(formData.get('quantity')) });
  if (!parsed.success) go(back, 'e', 'item_unavailable');
  if (!parsed.success) return;
  try {
    await apiRequest('/cart/items', { token, method: 'POST', body: parsed.data });
  } catch (e) {
    go(back, 'e', orderErrorCode(e));
  }
  go('/cart', 'm', 'added_to_cart');
}

export async function updateCartAction(formData: FormData) {
  const { token } = await requireSession('/cart');
  const id = uuidSchema.safeParse(str(formData.get('itemId')));
  const q = cartQuantitySchema.safeParse({ quantity: intField(formData.get('quantity')) });
  if (!id.success) go('/cart', 'e', 'not_found');
  if (!q.success) go('/cart', 'e', 'stock_limit');
  if (!id.success || !q.success) return;
  try {
    await apiRequest(`/cart/items/${id.data}`, { token, method: 'PUT', body: q.data });
  } catch (e) {
    go('/cart', 'e', orderErrorCode(e));
  }
  go('/cart', 'm', 'cart_updated');
}

export async function removeCartItemAction(formData: FormData) {
  const { token } = await requireSession('/cart');
  const id = uuidSchema.safeParse(str(formData.get('itemId')));
  if (!id.success) go('/cart', 'e', 'not_found');
  if (!id.success) return;
  try {
    await apiRequest(`/cart/items/${id.data}`, { token, method: 'DELETE' });
  } catch (e) {
    go('/cart', 'e', orderErrorCode(e));
  }
  go('/cart', 'm', 'cart_removed');
}
