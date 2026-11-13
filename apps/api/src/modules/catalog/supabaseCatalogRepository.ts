import type { SupabaseClient } from '@supabase/supabase-js';
import {
  LOW_STOCK_THRESHOLD,
  type AdminProductDetail, type AdminProductRow, type BrowseProductsQuery, type Category, type CategoryNode, type CreateProductInput,
  type Paged, type ProductCondition, type ProductEvent, type ProductImage, type ProductReviewAction, type ProductStatus,
  type ProductUpdateInput, type PublicProduct, type PublicProductCard, type SellerProduct, type SellerProductAction,
  type SellerProductRow, type SellerVariant, type StockMovement, type UpdateVariantInput, type VariantInput,
} from '@onwa/shared';
import type { CatalogRepository } from '../../deps.js';
import { mapDbError } from '../../lib/dbErrors.js';
import { badRequest, notFound } from '../../lib/errors.js';

const MEDIA_BUCKET = 'product-media';
const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

interface CatRow { id: string; parent_id: string | null; slug: string; name: string; sort_order: number; is_active: boolean }
interface ImgRow { id: string; storage_path: string; alt_text: string | null; position: number }
interface VarRow { id: string; sku: string | null; option_values: Record<string, string>; price_kobo: number; sale_price_kobo: number | null; stock_quantity: number; is_active: boolean; created_at: string }
interface ProdRow {
  id: string; slug: string; name: string; description: string | null; brand: string | null; condition: ProductCondition; status: ProductStatus;
  review_note: string | null; category_id: string | null; weight_grams: number | null; length_cm: number | null; width_cm: number | null;
  height_cm: number | null; shipping_requirements: string | null; options: { name: string; values: string[] }[]; attributes: Record<string, string>;
  price_from_kobo: number | null; total_stock: number; submitted_at: string | null; created_at: string; updated_at: string;
}

const toCategory = (r: CatRow): Category => ({ id: r.id, parentId: r.parent_id, slug: r.slug, name: r.name, sortOrder: r.sort_order, isActive: r.is_active });

export class SupabaseCatalogRepository implements CatalogRepository {
  constructor(private readonly db: SupabaseClient, private readonly supabaseUrl: string) {}

  private imageUrl(path: string): string {
    return `${this.supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${MEDIA_BUCKET}/${path}`;
  }
  private toImages(rows: ImgRow[] | null | undefined): ProductImage[] {
    return [...(rows ?? [])].sort((a, b) => a.position - b.position).map((i) => ({ id: i.id, url: this.imageUrl(i.storage_path), altText: i.alt_text, position: i.position }));
  }

  // ------------------------------------------------------------ public
  async listCategories(): Promise<CategoryNode[]> {
    const { data, error } = await this.db.from('categories').select('id,parent_id,slug,name,sort_order,is_active')
      .eq('is_active', true).eq('fulfilment', 'physical').order('sort_order').order('name');
    if (error) throw mapDbError(error);
    const all = ((data ?? []) as CatRow[]).map(toCategory);
    return all.filter((c) => !c.parentId).map((c) => ({ ...c, children: all.filter((x) => x.parentId === c.id) }));
  }

  async browseProducts(q: BrowseProductsQuery): Promise<Paged<PublicProductCard>> {
    const empty: Paged<PublicProductCard> = { rows: [], total: 0, limit: q.limit, offset: q.offset };

    let categoryIds: string[] | null = null;
    if (q.category) {
      const { data, error } = await this.db.from('categories').select('id,parent_id').eq('is_active', true);
      if (error) throw mapDbError(error);
      const rows = (data ?? []) as { id: string; parent_id: string | null }[];
      const cat = await this.db.from('categories').select('id').eq('slug', q.category).eq('is_active', true).maybeSingle();
      if (cat.error) throw mapDbError(cat.error);
      if (!cat.data) return empty;
      const id = (cat.data as { id: string }).id;
      categoryIds = [id, ...rows.filter((r) => r.parent_id === id).map((r) => r.id)];
    }
    let sellerId: string | null = null;
    if (q.store) {
      const { data, error } = await this.db.from('stores').select('seller_id').eq('slug', q.store).maybeSingle();
      if (error) throw mapDbError(error);
      if (!data) return empty;
      sellerId = (data as { seller_id: string }).seller_id;
    }

    let query = this.db.from('products')
      .select('slug,name,brand,price_from_kobo,total_stock, product_images(storage_path,position), product_variants(sale_price_kobo,is_active), sellers!inner(status, stores(name,slug))', { count: 'exact' })
      .eq('status', 'approved').eq('sellers.status', 'active');
    if (categoryIds) query = query.in('category_id', categoryIds);
    if (sellerId) query = query.eq('seller_id', sellerId);
    if (q.condition) query = query.eq('condition', q.condition);
    if (q.minPriceKobo !== undefined) query = query.gte('price_from_kobo', q.minPriceKobo);
    if (q.maxPriceKobo !== undefined) query = query.lte('price_from_kobo', q.maxPriceKobo);
    if (q.inStock) query = query.gt('total_stock', 0);
    if (q.q) query = query.or(`name.ilike.%${q.q}%,brand.ilike.%${q.q}%`);
    const ordered = q.sort === 'price_asc' ? query.order('price_from_kobo', { ascending: true, nullsFirst: false })
      : q.sort === 'price_desc' ? query.order('price_from_kobo', { ascending: false, nullsFirst: false })
      : query.order('approved_at', { ascending: false });
    const { data, error, count } = await ordered.range(q.offset, q.offset + q.limit - 1);
    if (error) throw mapDbError(error);

    type R = { slug: string; name: string; brand: string | null; price_from_kobo: number | null; total_stock: number; product_images: ImgRow[]; product_variants: { sale_price_kobo: number | null; is_active: boolean }[]; sellers: { stores: { name: string; slug: string } | { name: string; slug: string }[] | null } | { stores: { name: string; slug: string } | { name: string; slug: string }[] | null }[] };
    const rows = ((data ?? []) as unknown as R[]).map((r) => {
      const store = one(one(r.sellers)?.stores);
      return {
        slug: r.slug, name: r.name, brand: r.brand, priceFromKobo: r.price_from_kobo,
        hasSale: r.product_variants.some((v) => v.is_active && v.sale_price_kobo !== null),
        inStock: r.total_stock > 0, imageUrl: this.toImages(r.product_images)[0]?.url ?? null,
        storeName: store?.name ?? '', storeSlug: store?.slug ?? '',
      };
    });
    return { rows, total: count ?? rows.length, limit: q.limit, offset: q.offset };
  }

  async getPublicProduct(slug: string): Promise<PublicProduct | null> {
    const { data, error } = await this.db.from('products')
      .select('*, categories(slug,name), product_images(id,storage_path,alt_text,position), product_variants(id,option_values,price_kobo,sale_price_kobo,stock_quantity,is_active,created_at), sellers!inner(status, stores(slug,name,accent))')
      .eq('slug', slug).eq('status', 'approved').eq('sellers.status', 'active').maybeSingle();
    if (error) throw mapDbError(error);
    if (!data) return null;
    const r = data as unknown as ProdRow & {
      categories: { slug: string; name: string } | { slug: string; name: string }[] | null; product_images: ImgRow[]; product_variants: VarRow[];
      sellers: { stores: { slug: string; name: string; accent: string } | { slug: string; name: string; accent: string }[] | null } | { stores: { slug: string; name: string; accent: string } | { slug: string; name: string; accent: string }[] | null }[];
    };
    const store = one(one(r.sellers)?.stores);
    return {
      slug: r.slug, name: r.name, description: r.description, brand: r.brand, condition: r.condition, category: one(r.categories),
      options: r.options, attributes: r.attributes, weightGrams: r.weight_grams, shippingRequirements: r.shipping_requirements,
      images: this.toImages(r.product_images),
      variants: [...r.product_variants].filter((v) => v.is_active).sort((a, b) => a.created_at.localeCompare(b.created_at)).map((v) => ({
        id: v.id, optionValues: v.option_values, priceKobo: v.price_kobo, salePriceKobo: v.sale_price_kobo,
        inStock: v.stock_quantity > 0, lowStock: v.stock_quantity > 0 && v.stock_quantity <= LOW_STOCK_THRESHOLD,
      })),
      store: { slug: store?.slug ?? '', name: store?.name ?? '', accent: store?.accent ?? 'gold' },
    };
  }

  // ------------------------------------------------------------ seller
  async listMyProducts(sellerId: string, p: { status?: ProductStatus; limit: number; offset: number }): Promise<Paged<SellerProductRow>> {
    let q = this.db.from('products').select('id,slug,name,status,price_from_kobo,total_stock,updated_at, product_images(storage_path,position)', { count: 'exact' }).eq('seller_id', sellerId);
    if (p.status) q = q.eq('status', p.status);
    const { data, error, count } = await q.order('updated_at', { ascending: false }).range(p.offset, p.offset + p.limit - 1);
    if (error) throw mapDbError(error);
    type R = { id: string; slug: string; name: string; status: ProductStatus; price_from_kobo: number | null; total_stock: number; updated_at: string; product_images: ImgRow[] };
    const rows = ((data ?? []) as unknown as R[]).map((r) => ({
      id: r.id, slug: r.slug, name: r.name, status: r.status, priceFromKobo: r.price_from_kobo, totalStock: r.total_stock,
      imageUrl: this.toImages(r.product_images)[0]?.url ?? null, updatedAt: r.updated_at,
    }));
    return { rows, total: count ?? rows.length, limit: p.limit, offset: p.offset };
  }

  private toSellerProduct(r: ProdRow & { categories?: { name: string } | { name: string }[] | null; product_images: ImgRow[]; product_variants: VarRow[] }): SellerProduct {
    return {
      id: r.id, slug: r.slug, name: r.name, description: r.description, brand: r.brand, condition: r.condition, status: r.status,
      reviewNote: r.review_note, categoryId: r.category_id, categoryName: one(r.categories)?.name ?? null, weightGrams: r.weight_grams,
      lengthCm: r.length_cm, widthCm: r.width_cm, heightCm: r.height_cm, shippingRequirements: r.shipping_requirements,
      options: r.options, attributes: r.attributes, priceFromKobo: r.price_from_kobo, totalStock: r.total_stock,
      images: this.toImages(r.product_images),
      variants: [...r.product_variants].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((v): SellerVariant => ({
        id: v.id, sku: v.sku, optionValues: v.option_values, priceKobo: v.price_kobo, salePriceKobo: v.sale_price_kobo, stockQuantity: v.stock_quantity, isActive: v.is_active,
      })),
      createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }

  async getMyProduct(sellerId: string, id: string): Promise<SellerProduct | null> {
    const { data, error } = await this.db.from('products')
      .select('*, categories(name), product_images(id,storage_path,alt_text,position), product_variants(id,sku,option_values,price_kobo,sale_price_kobo,stock_quantity,is_active,created_at)')
      .eq('id', id).eq('seller_id', sellerId).maybeSingle();
    if (error) throw mapDbError(error);
    return data ? this.toSellerProduct(data as unknown as ProdRow & { product_images: ImgRow[]; product_variants: VarRow[] }) : null;
  }

  async createProduct(sellerId: string, input: CreateProductInput): Promise<string> {
    const { data, error } = await this.db.rpc('create_product', { p_seller: sellerId, p: input });
    if (error) throw mapDbError(error);
    return data as string;
  }

  private async assertCategory(categoryId: string | undefined): Promise<void> {
    if (!categoryId) return;
    const { data, error } = await this.db.from('categories').select('id').eq('id', categoryId).eq('is_active', true).eq('fulfilment', 'physical').maybeSingle();
    if (error) throw mapDbError(error);
    if (!data) throw badRequest('Choose a valid category');
  }

  async updateProduct(sellerId: string, id: string, input: ProductUpdateInput): Promise<SellerProduct> {
    await this.assertCategory(input.categoryId);
    const { data, error } = await this.db.from('products').update({
      name: input.name, description: input.description ?? null, brand: input.brand ?? null, condition: input.condition,
      category_id: input.categoryId ?? null, weight_grams: input.weightGrams ?? null, length_cm: input.lengthCm ?? null,
      width_cm: input.widthCm ?? null, height_cm: input.heightCm ?? null, shipping_requirements: input.shippingRequirements ?? null,
      attributes: input.attributes ?? {},
    }).eq('id', id).eq('seller_id', sellerId).select('id').maybeSingle();
    if (error) throw mapDbError(error);
    if (!data) throw notFound('Product not found');
    const product = await this.getMyProduct(sellerId, id);
    if (!product) throw notFound('Product not found');
    return product;
  }

  async changeProductStatus(sellerId: string, id: string, action: SellerProductAction): Promise<void> {
    const { error } = await this.db.rpc('seller_change_product_status', { p_seller: sellerId, p_product: id, p_action: action });
    if (error) throw mapDbError(error);
  }

  async addVariant(sellerId: string, productId: string, input: VariantInput): Promise<string> {
    const { data, error } = await this.db.rpc('add_variant', { p_seller: sellerId, p_product: productId, p: input });
    if (error) throw mapDbError(error);
    return data as string;
  }

  async updateVariant(sellerId: string, variantId: string, input: UpdateVariantInput): Promise<void> {
    const { data, error } = await this.db.from('product_variants').update({
      sku: input.sku ?? null, price_kobo: input.priceKobo, sale_price_kobo: input.salePriceKobo ?? null, is_active: input.isActive,
    }).eq('id', variantId).eq('seller_id', sellerId).select('id');
    if (error) throw mapDbError(error);
    if (!data || data.length === 0) throw notFound('Variant not found');
  }

  async adjustStock(sellerId: string, variantId: string, delta: number, reason: string, note?: string): Promise<number> {
    const { data, error } = await this.db.rpc('seller_adjust_stock', { p_seller: sellerId, p_variant: variantId, p_delta: delta, p_reason: reason, p_note: note ?? null });
    if (error) throw mapDbError(error);
    return data as number;
  }

  async listMovements(sellerId: string, productId: string, limit: number): Promise<StockMovement[]> {
    const { data, error } = await this.db.from('inventory_movements').select('id,variant_id,delta,reason,quantity_after,note,created_at')
      .eq('product_id', productId).eq('seller_id', sellerId).order('created_at', { ascending: false }).limit(limit);
    if (error) throw mapDbError(error);
    return ((data ?? []) as { id: string; variant_id: string; delta: number; reason: string; quantity_after: number; note: string | null; created_at: string }[])
      .map((m) => ({ id: m.id, variantId: m.variant_id, delta: m.delta, reason: m.reason, quantityAfter: m.quantity_after, note: m.note, createdAt: m.created_at }));
  }

  async addImage(sellerId: string, productId: string, path: string, altText?: string): Promise<ProductImage> {
    const owner = await this.db.from('products').select('id').eq('id', productId).eq('seller_id', sellerId).maybeSingle();
    if (owner.error) throw mapDbError(owner.error);
    if (!owner.data) throw notFound('Product not found');
    const { data, error } = await this.db.from('product_images').insert({ product_id: productId, seller_id: sellerId, storage_path: path, alt_text: altText ?? null })
      .select('id,storage_path,alt_text,position').single();
    if (error) throw mapDbError(error);
    return this.toImages([data as ImgRow])[0] as ProductImage;
  }

  async removeImage(sellerId: string, productId: string, imageId: string): Promise<void> {
    const found = await this.db.from('product_images').select('id,storage_path').eq('id', imageId).eq('product_id', productId).eq('seller_id', sellerId).maybeSingle();
    if (found.error) throw mapDbError(found.error);
    if (!found.data) throw notFound('Image not found');
    const del = await this.db.from('product_images').delete().eq('id', imageId);
    if (del.error) throw mapDbError(del.error);
    await this.db.storage.from(MEDIA_BUCKET).remove([(found.data as { storage_path: string }).storage_path]);
  }

  // ------------------------------------------------------------ staff
  async listAdminProducts(p: { status?: ProductStatus; limit: number; offset: number }): Promise<Paged<AdminProductRow>> {
    const status = p.status ?? 'pending_review';
    const q = this.db.from('products').select('id,slug,name,status,submitted_at,updated_at, sellers!inner(stores(name))', { count: 'exact' }).eq('status', status);
    const ordered = status === 'pending_review' ? q.order('submitted_at', { ascending: true, nullsFirst: false }) : q.order('updated_at', { ascending: false });
    const { data, error, count } = await ordered.range(p.offset, p.offset + p.limit - 1);
    if (error) throw mapDbError(error);
    type R = { id: string; slug: string; name: string; status: ProductStatus; submitted_at: string | null; updated_at: string; sellers: { stores: { name: string } | { name: string }[] | null } | { stores: { name: string } | { name: string }[] | null }[] };
    const rows = ((data ?? []) as unknown as R[]).map((r) => ({
      id: r.id, slug: r.slug, name: r.name, status: r.status, storeName: one(one(r.sellers)?.stores)?.name ?? '', submittedAt: r.submitted_at, updatedAt: r.updated_at,
    }));
    return { rows, total: count ?? rows.length, limit: p.limit, offset: p.offset };
  }

  async getAdminProduct(id: string): Promise<AdminProductDetail | null> {
    const { data, error } = await this.db.from('products')
      .select('*, categories(name), product_images(id,storage_path,alt_text,position), product_variants(id,sku,option_values,price_kobo,sale_price_kobo,stock_quantity,is_active,created_at), sellers(stores(name,slug))')
      .eq('id', id).maybeSingle();
    if (error) throw mapDbError(error);
    if (!data) return null;
    const r = data as unknown as ProdRow & { product_images: ImgRow[]; product_variants: VarRow[]; sellers: { stores: { name: string; slug: string } | { name: string; slug: string }[] | null } | { stores: { name: string; slug: string } | { name: string; slug: string }[] | null }[] };
    const ev = await this.db.from('product_events').select('id,from_status,to_status,note,created_at').eq('product_id', id).order('created_at', { ascending: true });
    if (ev.error) throw mapDbError(ev.error);
    const events: ProductEvent[] = ((ev.data ?? []) as { id: string; from_status: string | null; to_status: string; note: string | null; created_at: string }[])
      .map((e) => ({ id: e.id, fromStatus: e.from_status, toStatus: e.to_status, note: e.note, createdAt: e.created_at }));
    const store = one(one(r.sellers)?.stores);
    return { ...this.toSellerProduct(r), storeName: store?.name ?? '', storeSlug: store?.slug ?? '', events };
  }

  async reviewProduct(actorId: string, id: string, action: ProductReviewAction, note?: string): Promise<void> {
    const { error } = await this.db.rpc('review_product', { p_actor: actorId, p_product: id, p_action: action, p_note: note ?? null });
    if (error) throw mapDbError(error);
  }

  async listAdminCategories(): Promise<Category[]> {
    const { data, error } = await this.db.from('categories').select('id,parent_id,slug,name,sort_order,is_active').order('sort_order').order('name');
    if (error) throw mapDbError(error);
    return ((data ?? []) as CatRow[]).map(toCategory);
  }

  async createCategory(actorId: string, name: string, parentId: string | undefined, sortOrder: number): Promise<string> {
    const { data, error } = await this.db.rpc('create_category', { p_actor: actorId, p_name: name, p_parent: parentId ?? null, p_sort: sortOrder });
    if (error) throw mapDbError(error);
    return data as string;
  }

  async updateCategory(actorId: string, id: string, input: { name: string; sortOrder: number; isActive: boolean }): Promise<void> {
    const { error } = await this.db.rpc('update_category', { p_actor: actorId, p_id: id, p_name: input.name, p_sort: input.sortOrder, p_active: input.isActive });
    if (error) throw mapDbError(error);
  }
}
