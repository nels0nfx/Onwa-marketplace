import { z } from 'zod';

export const ORDER_EXPIRY_MINUTES = 30;
export const RETURN_WINDOW_DAYS = 7;
export const MAX_CART_LINES = 50;
export const MAX_LINE_QUANTITY = 99;

// Parent order status (payment-level). Fulfilment progress lives on each seller order.
export const ORDER_STATUSES = ['pending_payment', 'paid', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

// Physical fulfilment workflow, kept separate from digital and service workflows (added in later stages).
export const PHYSICAL_STATUSES = [
  'pending_payment', 'paid', 'processing', 'ready_for_dispatch', 'dispatched', 'in_transit', 'delivered', 'completed',
  'cancelled', 'return_requested', 'returned', 'refund_pending', 'refunded',
] as const;
export type PhysicalStatus = (typeof PHYSICAL_STATUSES)[number];

export const PHYSICAL_STATUS_LABELS: Record<PhysicalStatus, string> = {
  pending_payment: 'Awaiting payment',
  paid: 'Paid',
  processing: 'Processing',
  ready_for_dispatch: 'Ready for dispatch',
  dispatched: 'Dispatched',
  in_transit: 'In transit',
  delivered: 'Delivered',
  completed: 'Completed',
  cancelled: 'Cancelled',
  return_requested: 'Return requested',
  returned: 'Returned',
  refund_pending: 'Refund pending',
  refunded: 'Refunded',
};

export const ORDER_ACTIONS = [
  'cancel', 'start_processing', 'mark_ready', 'dispatch', 'mark_in_transit', 'mark_delivered', 'confirm_received', 'request_return',
] as const;
export type OrderAction = (typeof ORDER_ACTIONS)[number];

export const ORDER_ACTION_LABELS: Record<OrderAction, string> = {
  cancel: 'Cancel order',
  start_processing: 'Start processing',
  mark_ready: 'Mark ready for dispatch',
  dispatch: 'Mark dispatched',
  mark_in_transit: 'Mark in transit',
  mark_delivered: 'Mark delivered',
  confirm_received: 'Confirm I received it',
  request_return: 'Request a return',
};

export type ActorKind = 'buyer' | 'seller' | 'staff';

/**
 * Actions available in this release. Payment confirmation (pending_payment -> paid) and the refund/return tail
 * (returned, refund_pending, refunded) are performed only by the payment system in Stage 5 and are deliberately
 * not user actions.
 */
export const ORDER_ACTION_RULES: Record<OrderAction, { from: PhysicalStatus; to: PhysicalStatus; actors: readonly ActorKind[] }> = {
  cancel: { from: 'pending_payment', to: 'cancelled', actors: ['buyer', 'staff'] },
  start_processing: { from: 'paid', to: 'processing', actors: ['seller', 'staff'] },
  mark_ready: { from: 'processing', to: 'ready_for_dispatch', actors: ['seller', 'staff'] },
  dispatch: { from: 'ready_for_dispatch', to: 'dispatched', actors: ['seller', 'staff'] },
  mark_in_transit: { from: 'dispatched', to: 'in_transit', actors: ['seller', 'staff'] },
  mark_delivered: { from: 'in_transit', to: 'delivered', actors: ['seller', 'staff'] },
  confirm_received: { from: 'delivered', to: 'completed', actors: ['buyer', 'staff'] },
  request_return: { from: 'delivered', to: 'return_requested', actors: ['buyer'] },
};

export type OrderTransition = { allowed: true; to: PhysicalStatus } | { allowed: false; reason: string };

/** Mirrors public.change_order_status. The database remains the final authority. */
export function nextOrderStatus(
  current: PhysicalStatus, action: OrderAction, actors: readonly ActorKind[],
  opts: { deliveredAt?: Date | null; now?: Date } = {},
): OrderTransition {
  const rule = ORDER_ACTION_RULES[action];
  if (!rule.actors.some((a) => actors.includes(a))) return { allowed: false, reason: 'You cannot do this on this order' };
  if (current !== rule.from) return { allowed: false, reason: `Cannot ${action.replace(/_/g, ' ')} an order that is ${PHYSICAL_STATUS_LABELS[current].toLowerCase()}` };
  if (action === 'request_return') {
    const now = opts.now ?? new Date();
    const delivered = opts.deliveredAt;
    if (!delivered || now.getTime() - delivered.getTime() > RETURN_WINDOW_DAYS * 86_400_000) {
      return { allowed: false, reason: `Returns can be requested within ${RETURN_WINDOW_DAYS} days of delivery` };
    }
  }
  return { allowed: true, to: rule.to };
}

export function availableOrderActions(
  current: PhysicalStatus, actors: readonly ActorKind[], opts: { deliveredAt?: Date | null; now?: Date } = {},
): OrderAction[] {
  return ORDER_ACTIONS.filter((a) => nextOrderStatus(current, a, actors, opts).allowed);
}

// ---------------------------------------------------------------- validation
const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

export const addToCartSchema = z
  .object({ variantId: z.string().uuid(), quantity: z.number().int().min(1, 'Quantity must be at least 1').max(MAX_LINE_QUANTITY, `Quantity can be at most ${MAX_LINE_QUANTITY}`) })
  .strict();

export const cartQuantitySchema = z
  .object({ quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY) })
  .strict();

export const checkoutSchema = z
  .object({
    storeSlug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).min(3).max(60),
    addressId: z.string().uuid('Choose a delivery address'),
    note: z.preprocess(emptyToUndefined, z.string().trim().max(300, 'Use at most 300 characters').optional()),
    idempotencyKey: z.string().uuid(),
  })
  .strict();
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const orderActionSchema = z
  .object({ action: z.enum(ORDER_ACTIONS), note: z.preprocess(emptyToUndefined, z.string().trim().max(300).optional()) })
  .strict();

export const listOrdersQuerySchema = z.object({
  status: z.enum(PHYSICAL_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});

export function formatOrderNumber(n: number): string {
  return `ONWA-${n}`;
}
