import { ApiError } from '@/lib/api';

/** Maps an API failure to a message code. Messages come from fixed tables, never from the API text itself. */
export function orderErrorCode(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403) return /own product/i.test(e.message) ? 'own_product' : 'forbidden_action';
    if (e.status === 404) return 'not_found';
    if (e.status === 409) {
      if (/only \d+ available|insufficient stock/i.test(e.message)) return 'stock_limit';
      if (/not available|no longer available|not accepting/i.test(e.message)) return 'item_unavailable';
      if (/within 7 days/i.test(e.message)) return 'return_window';
      return 'conflict_action';
    }
    if (e.status === 400) return /no items|cart/i.test(e.message) ? 'cart_not_ready' : 'validation';
  }
  return 'service_error';
}
