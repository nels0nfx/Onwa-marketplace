import type { SupabaseClient } from '@supabase/supabase-js';
import {
  MAX_LINE_QUANTITY, availableOrderActions,
  type AdminOrderRow, type CartGroup, type CartItemView, type CartView, type OrderAction, type OrderDetail, type OrderHistoryEntry,
  type OrderItemView, type OrderStatus, type OrderSummary, type Paged, type PhysicalStatus, type SellerOrderDetail, type SellerOrderRow,
  type ShippingAddressSnapshot, type SuborderView,
} from '@onwa/shared';
import type { OrderRepository } from '../../deps.js';
import { mapDbError } from '../../lib/dbErrors.js';
import { notFound } from '../../lib/errors.js';

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

interface ImgRow { storage_path: string; position: number }
interface ItemRow {
  id: string; product_name: string; variant_label: string; sku: string | null; image_path: string | null; unit_price_kobo: number;
  quantity: number; line_total_kobo: number; products?: { slug: string } | { slug: string }[] | null;
}
interface HistRow { id: string; from_status: string | null; to_status: string; note: string | null; created_at: string }
interface SubRow {
  id: string; status: PhysicalStatus; subtotal_kobo: number; shipping_kobo: number; total_kobo: number; delivered_at: string | null; paid_at: string | null;
  created_at: string; order_items: ItemRow[]; order_status_history: HistRow[];
  sellers?: { stores: { slug: string; name: string } | { slug: string; name: string }[] | null } | { stores: { slug: string; name: string } | { slug: string; name: string }[] | null }[] | null;
}
interface OrderRow {
  id: string; order_number: number; status: OrderStatus; currency: string; subtotal_kobo: number; shipping_kobo: number; total_kobo: number;
  shipping_address: ShippingAddressSnapshot; note: string | null; expires_at: string | null; paid_at: string | null; created_at: string; seller_orders: SubRow[];
}

export class SupabaseOrderRepository implements OrderRepository {
  constructor(private readonly db: SupabaseClient, private readonly supabaseUrl: string) {}

  private imageUrl(path: string | null): string | null {
    return path ? `${this.supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/product-media/${path}` : null;
  }

  // ------------------------------------------------------------ cart
  async getCart(userId: string): Promise<CartView> {
    const { data, error } = await this.db.from('cart_items')
      .select('id, quantity, created_at, carts!inner(user_id), product_variants(id, option_values, price_kobo, sale_price_kobo, stock_quantity, is_active, products(id, slug, name, status, options, seller_id, product_images(storage_path, position), sellers(status, stores(name, slug))))')
      .eq('carts.user_id', userId).order('created_at', { ascending: true });
    if (error) throw mapDbError(error);

    type V = {
      id: string; option_values: Record<string, string>; price_kobo: number; sale_price_kobo: number | null; stock_quantity: number; is_active: boolean;
      products: { id: string; slug: string; name: string; status: string; options: { name: string }[]; seller_id: string; product_images: ImgRow[];
        sellers: { status: string; stores: { name: string; slug: string } | { name: string; slug: string }[] | null } | { status: string; stores: { name: string; slug: string } | { name: string; slug: string }[] | null }[] } | null;
    };
    type R = { id: string; quantity: number; product_variants: V | V[] | null };

    const groups = new Map<string, CartGroup>();
    let itemCount = 0;
    for (const row of (data ?? []) as unknown as R[]) {
      const v = one(row.product_variants);
      const p = v?.products ? one(v.products) : null;
      if (!v || !p) continue;
      const seller = one(p.sellers);
      const store = one(seller?.stores);
      const stock = v.stock_quantity;
      const available = v.is_active && p.status === 'approved' && seller?.status === 'active' && stock > 0;
      const unit = v.sale_price_kobo ?? v.price_kobo;
      const problem = !(v.is_active && p.status === 'approved' && seller?.status === 'active') ? 'No longer available'
        : stock === 0 ? 'Out of stock' : row.quantity > stock ? `Only ${stock} left` : null;
      const label = p.options.length ? p.options.map((o) => v.option_values[o.name]).filter(Boolean).join(' / ') : 'Standard';
      const first = [...(p.product_images ?? [])].sort((a, b) => a.position - b.position)[0];
      const item: CartItemView = {
        id: row.id, variantId: v.id, productSlug: p.slug, productName: p.name, variantLabel: label || 'Standard',
        imageUrl: this.imageUrl(first?.storage_path ?? null), listPriceKobo: v.price_kobo, unitPriceKobo: unit, quantity: row.quantity,
        lineTotalKobo: unit * row.quantity, available, maxQuantity: Math.min(stock, MAX_LINE_QUANTITY), problem,
      };
      const group = groups.get(p.seller_id) ?? { sellerId: p.seller_id, store: { slug: store?.slug ?? '', name: store?.name ?? 'Store' }, items: [], subtotalKobo: 0, checkoutReady: true };
      group.items.push(item);
      group.subtotalKobo += item.lineTotalKobo;
      if (problem !== null) group.checkoutReady = false;
      groups.set(p.seller_id, group);
      itemCount += row.quantity;
    }
    return { groups: [...groups.values()].sort((a, b) => a.store.name.localeCompare(b.store.name)), itemCount };
  }

  async addToCart(userId: string, variantId: string, quantity: number): Promise<void> {
    const { error } = await this.db.rpc('cart_add_item', { p_user: userId, p_variant: variantId, p_qty: quantity });
    if (error) throw mapDbError(error);
  }

  async setCartQuantity(userId: string, itemId: string, quantity: number): Promise<void> {
    const { error } = await this.db.rpc('cart_set_quantity', { p_user: userId, p_item: itemId, p_qty: quantity });
    if (error) throw mapDbError(error);
  }

  async removeCartItem(userId: string, itemId: string): Promise<void> {
    const cart = await this.db.from('carts').select('id').eq('user_id', userId).maybeSingle();
    if (cart.error) throw mapDbError(cart.error);
    if (!cart.data) return;
    const del = await this.db.from('cart_items').delete().eq('id', itemId).eq('cart_id', (cart.data as { id: string }).id);
    if (del.error) throw mapDbError(del.error);
  }

  // ------------------------------------------------------------ checkout
  async createOrder(userId: string, storeSlug: string, addressId: string, note: string | undefined, idempotencyKey: string): Promise<string> {
    const store = await this.db.from('stores').select('seller_id').eq('slug', storeSlug).maybeSingle();
    if (store.error) throw mapDbError(store.error);
    if (!store.data) throw notFound('Store not found');
    const { data, error } = await this.db.rpc('create_order', {
      p_buyer: userId, p_seller: (store.data as { seller_id: string }).seller_id, p_address: addressId, p_note: note ?? null, p_key: idempotencyKey,
    });
    if (error) throw mapDbError(error);
    return data as string;
  }

  // ------------------------------------------------------------ mapping helpers
  private toItem(i: ItemRow): OrderItemView {
    return {
      id: i.id, productName: i.product_name, productSlug: one(i.products)?.slug ?? null, variantLabel: i.variant_label, sku: i.sku,
      imageUrl: this.imageUrl(i.image_path), unitPriceKobo: i.unit_price_kobo, quantity: i.quantity, lineTotalKobo: i.line_total_kobo,
    };
  }
  private toHistory(rows: HistRow[]): OrderHistoryEntry[] {
    return [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((h) => ({ id: h.id, fromStatus: h.from_status, toStatus: h.to_status, note: h.note, createdAt: h.created_at }));
  }
  private toDetail(r: OrderRow, actors: ('buyer' | 'staff')[]): OrderDetail {
    const suborders: SuborderView[] = r.seller_orders.map((so) => {
      const store = one(one(so.sellers)?.stores);
      return {
        id: so.id, status: so.status, store: { slug: store?.slug ?? '', name: store?.name ?? '' }, subtotalKobo: so.subtotal_kobo,
        shippingKobo: so.shipping_kobo, totalKobo: so.total_kobo, deliveredAt: so.delivered_at,
        items: so.order_items.map((i) => this.toItem(i)), history: this.toHistory(so.order_status_history),
        actions: availableOrderActions(so.status, actors, { deliveredAt: so.delivered_at ? new Date(so.delivered_at) : null }),
      };
    });
    return {
      id: r.id, orderNumber: r.order_number, status: r.status, totalKobo: r.total_kobo, subtotalKobo: r.subtotal_kobo, shippingKobo: r.shipping_kobo,
      currency: r.currency, note: r.note, expiresAt: r.status === 'pending_payment' ? r.expires_at : null, paidAt: r.paid_at, createdAt: r.created_at,
      itemCount: suborders.reduce((n, s) => n + s.items.reduce((m, i) => m + i.quantity, 0), 0),
      storeNames: suborders.map((s) => s.store.name), shippingAddress: r.shipping_address, suborders,
    };
  }
  private static readonly DETAIL_SELECT =
    '*, seller_orders(*, order_items(*, products(slug)), order_status_history(*), sellers(stores(name, slug)))';

  // ------------------------------------------------------------ buyer
  async listOrders(userId: string, p: { limit: number; offset: number }): Promise<Paged<OrderSummary>> {
    const { data, error, count } = await this.db.from('orders')
      .select('id, order_number, status, total_kobo, created_at, seller_orders(order_items(quantity), sellers(stores(name)))', { count: 'exact' })
      .eq('buyer_id', userId).order('created_at', { ascending: false }).range(p.offset, p.offset + p.limit - 1);
    if (error) throw mapDbError(error);
    type R = { id: string; order_number: number; status: OrderStatus; total_kobo: number; created_at: string;
      seller_orders: { order_items: { quantity: number }[]; sellers: { stores: { name: string } | { name: string }[] | null } | { stores: { name: string } | { name: string }[] | null }[] | null }[] };
    const rows = ((data ?? []) as unknown as R[]).map((r) => ({
      id: r.id, orderNumber: r.order_number, status: r.status, totalKobo: r.total_kobo, createdAt: r.created_at,
      itemCount: r.seller_orders.reduce((n, so) => n + so.order_items.reduce((m, i) => m + i.quantity, 0), 0),
      storeNames: r.seller_orders.map((so) => one(one(so.sellers)?.stores)?.name ?? '').filter(Boolean),
    }));
    return { rows, total: count ?? rows.length, limit: p.limit, offset: p.offset };
  }

  async getOrder(userId: string, id: string): Promise<OrderDetail | null> {
    const { data, error } = await this.db.from('orders').select(SupabaseOrderRepository.DETAIL_SELECT).eq('id', id).eq('buyer_id', userId).maybeSingle();
    if (error) throw mapDbError(error);
    return data ? this.toDetail(data as unknown as OrderRow, ['buyer']) : null;
  }

  // ------------------------------------------------------------ seller (paid orders only)
  async listSellerOrders(sellerId: string, p: { status?: PhysicalStatus; limit: number; offset: number }): Promise<Paged<SellerOrderRow>> {
    let q = this.db.from('seller_orders').select('id, status, total_kobo, created_at, orders!inner(order_number), order_items(quantity)', { count: 'exact' })
      .eq('seller_id', sellerId).not('paid_at', 'is', null);
    if (p.status) q = q.eq('status', p.status);
    const { data, error, count } = await q.order('created_at', { ascending: false }).range(p.offset, p.offset + p.limit - 1);
    if (error) throw mapDbError(error);
    type R = { id: string; status: PhysicalStatus; total_kobo: number; created_at: string; orders: { order_number: number } | { order_number: number }[]; order_items: { quantity: number }[] };
    const rows = ((data ?? []) as unknown as R[]).map((r) => ({
      id: r.id, orderNumber: one(r.orders)?.order_number ?? 0, status: r.status, totalKobo: r.total_kobo, createdAt: r.created_at,
      itemCount: r.order_items.reduce((n, i) => n + i.quantity, 0),
    }));
    return { rows, total: count ?? rows.length, limit: p.limit, offset: p.offset };
  }

  async getSellerOrder(sellerId: string, id: string): Promise<SellerOrderDetail | null> {
    const { data, error } = await this.db.from('seller_orders')
      .select('*, orders!inner(order_number, note, shipping_address), order_items(*), order_status_history(*)')
      .eq('id', id).eq('seller_id', sellerId).not('paid_at', 'is', null).maybeSingle();
    if (error) throw mapDbError(error);
    if (!data) return null;
    const r = data as unknown as SubRow & { orders: { order_number: number; note: string | null; shipping_address: ShippingAddressSnapshot } | { order_number: number; note: string | null; shipping_address: ShippingAddressSnapshot }[] };
    const o = one(r.orders);
    // Address and contact details are released only because this order has been paid.
    return {
      id: r.id, orderNumber: o?.order_number ?? 0, status: r.status, subtotalKobo: r.subtotal_kobo, shippingKobo: r.shipping_kobo, totalKobo: r.total_kobo,
      createdAt: r.created_at, deliveredAt: r.delivered_at, note: o?.note ?? null,
      buyer: o ? { name: o.shipping_address.recipientName, phone: o.shipping_address.phone } : null,
      shippingAddress: o?.shipping_address ?? null, items: r.order_items.map((i) => this.toItem(i)), history: this.toHistory(r.order_status_history),
      actions: availableOrderActions(r.status, ['seller'], { deliveredAt: r.delivered_at ? new Date(r.delivered_at) : null }),
    };
  }

  async changeStatus(actorId: string, sellerOrderId: string, action: OrderAction, note?: string): Promise<void> {
    const { error } = await this.db.rpc('change_order_status', { p_actor: actorId, p_seller_order: sellerOrderId, p_action: action, p_note: note ?? null });
    if (error) throw mapDbError(error);
  }

  // ------------------------------------------------------------ staff
  async listAdminOrders(p: { status?: OrderStatus; limit: number; offset: number }): Promise<Paged<AdminOrderRow>> {
    let q = this.db.from('orders').select('id, order_number, status, total_kobo, created_at, expires_at, profiles!orders_buyer_id_fkey(email)', { count: 'exact' });
    if (p.status) q = q.eq('status', p.status);
    const { data, error, count } = await q.order('created_at', { ascending: false }).range(p.offset, p.offset + p.limit - 1);
    if (error) throw mapDbError(error);
    type R = { id: string; order_number: number; status: OrderStatus; total_kobo: number; created_at: string; expires_at: string | null; profiles: { email: string } | { email: string }[] | null };
    const rows = ((data ?? []) as unknown as R[]).map((r) => ({
      id: r.id, orderNumber: r.order_number, status: r.status, buyerEmail: one(r.profiles)?.email ?? '', totalKobo: r.total_kobo, createdAt: r.created_at, expiresAt: r.expires_at,
    }));
    return { rows, total: count ?? rows.length, limit: p.limit, offset: p.offset };
  }

  async getAdminOrder(id: string): Promise<OrderDetail | null> {
    const { data, error } = await this.db.from('orders').select(SupabaseOrderRepository.DETAIL_SELECT).eq('id', id).maybeSingle();
    if (error) throw mapDbError(error);
    return data ? this.toDetail(data as unknown as OrderRow, ['staff']) : null;
  }

  async expireUnpaid(): Promise<number> {
    const { data, error } = await this.db.rpc('expire_unpaid_orders', { p_limit: 100 });
    if (error) throw mapDbError(error);
    return typeof data === 'number' ? data : 0;
  }
}
