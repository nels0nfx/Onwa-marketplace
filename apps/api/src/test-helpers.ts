import type {
  AdminApplicationDetail, AdminApplicationRow, AdminSellerRow, AdminUserRow, Address, AddressInput, ApplicationDocument,
  ApplicationStatus, AuditLogRow, Paged, PermissionCode, Profile, PublicStore, PublicStoreCard, ReviewAction, RoleCode,
  RoleSummary, SellerApplication, SellerApplicationDraftInput, SellerStatus, StoreProfile, StoreProfileInput,
} from '@onwa/shared';
import { ROLE_DEFINITIONS, ROLE_PERMISSIONS, STATUS_LABELS, canApplicantSubmit, missingForSubmission, nextStatusForReview } from '@onwa/shared';
import type { AdminOrderRow, CartView, OrderAction, OrderDetail, OrderStatus, OrderSummary, PhysicalStatus, SellerOrderDetail, SellerOrderRow } from '@onwa/shared';
import { availableOrderActions, nextOrderStatus } from '@onwa/shared';
import type { AdminProductDetail, AdminProductRow, BrowseProductsQuery, Category, CategoryNode, CreateProductInput, ProductImage, ProductReviewAction, ProductStatus, ProductUpdateInput, PublicProduct, PublicProductCard, SellerProduct, SellerProductAction, SellerProductRow, StockMovement, UpdateVariantInput, VariantInput } from '@onwa/shared';
import { nextProductStatusForReview, nextProductStatusForSeller } from '@onwa/shared';
import type { AddressRepository, AppDeps, CatalogRepository, OrderRepository, NewDocument, SellerRepository, TokenVerifier, UserAccess, UserRepository } from './deps.js';
import { AppError, badRequest, forbidden, notFound } from './lib/errors.js';
import { createLogger } from './lib/logger.js';

export const IDS = {
  alice: '00000000-0000-4000-8000-00000000000a',
  bob: '00000000-0000-4000-8000-00000000000b',
  carol: '00000000-0000-4000-8000-00000000000c',
  dave: '00000000-0000-4000-8000-00000000000d',
  erin: '00000000-0000-4000-8000-00000000000e',
  suspended: '00000000-0000-4000-8000-00000000000f',
  manager: '00000000-0000-4000-8000-000000000010',
  seller: '00000000-0000-4000-8000-000000000011',
  ops: '00000000-0000-4000-8000-000000000012',
} as const;

function profile(id: string, name: string, status: Profile['status'] = 'active'): Profile {
  return { id, email: `${name.toLowerCase()}@example.test`, fullName: name, phone: null, avatarUrl: null, status, createdAt: '2026-01-01T00:00:00.000Z' };
}

export class FakeUsers implements UserRepository {
  profiles = new Map<string, Profile>([
    [IDS.alice, profile(IDS.alice, 'Alice')],
    [IDS.bob, profile(IDS.bob, 'Bob')],
    [IDS.carol, profile(IDS.carol, 'Carol')],
    [IDS.dave, profile(IDS.dave, 'Dave')],
    [IDS.erin, profile(IDS.erin, 'Erin')],
    [IDS.suspended, profile(IDS.suspended, 'Sam', 'suspended')],
    [IDS.manager, profile(IDS.manager, 'Mia')],
    [IDS.seller, profile(IDS.seller, 'Selma')],
    [IDS.ops, profile(IDS.ops, 'Omar')],
  ]);
  roles = new Map<string, RoleCode[]>([
    [IDS.alice, ['customer']],
    [IDS.bob, ['customer']],
    [IDS.carol, ['customer', 'super_admin']],
    [IDS.dave, ['customer', 'finance_manager']],
    [IDS.erin, ['customer', 'customer_support']],
    [IDS.suspended, ['customer']],
    [IDS.manager, ['customer', 'seller_manager']],
    [IDS.seller, ['customer', 'seller']],
    [IDS.ops, ['customer', 'operations_manager']],
  ]);
  calls: { fn: string; args: unknown[] }[] = [];

  async getProfile(id: string) { return this.profiles.get(id) ?? null; }

  async updateProfile(id: string, patch: { fullName?: string; phone?: string | null }) {
    this.calls.push({ fn: 'updateProfile', args: [id, patch] });
    const current = this.profiles.get(id);
    if (!current) throw new Error('missing');
    const next = { ...current, ...(patch.fullName !== undefined ? { fullName: patch.fullName } : {}), ...(patch.phone !== undefined ? { phone: patch.phone } : {}) };
    this.profiles.set(id, next);
    return next;
  }

  async getAccess(id: string): Promise<UserAccess> {
    const roles = this.roles.get(id) ?? [];
    const permissions = [...new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r]))] as PermissionCode[];
    return { roles, permissions };
  }

  async listUsers(p: { q?: string; limit: number; offset: number }): Promise<Paged<AdminUserRow>> {
    this.calls.push({ fn: 'listUsers', args: [p] });
    const rows = [...this.profiles.values()].map((pr) => ({ ...pr, roles: this.roles.get(pr.id) ?? [] }));
    return { rows, total: rows.length, limit: p.limit, offset: p.offset };
  }

  async listRoles(): Promise<RoleSummary[]> {
    return (Object.keys(ROLE_DEFINITIONS) as RoleCode[]).map((code) => ({
      code, name: ROLE_DEFINITIONS[code].name, description: ROLE_DEFINITIONS[code].description, isStaff: ROLE_DEFINITIONS[code].isStaff, permissions: [...ROLE_PERMISSIONS[code]],
    }));
  }

  async assignRole(actor: string, target: string, role: RoleCode) { this.calls.push({ fn: 'assignRole', args: [actor, target, role] }); }
  async revokeRole(actor: string, target: string, role: RoleCode) { this.calls.push({ fn: 'revokeRole', args: [actor, target, role] }); }
  async listAuditLogs(p: { limit: number; offset: number }): Promise<Paged<AuditLogRow>> { return { rows: [], total: 0, limit: p.limit, offset: p.offset }; }
}

export class FakeVerifier implements TokenVerifier {
  tokens = new Map<string, string>([
    ['tok-alice', IDS.alice], ['tok-bob', IDS.bob], ['tok-carol', IDS.carol], ['tok-dave', IDS.dave], ['tok-erin', IDS.erin], ['tok-suspended', IDS.suspended],
    ['tok-manager', IDS.manager], ['tok-seller', IDS.seller], ['tok-ops', IDS.ops],
  ]);
  async verify(token: string) {
    const id = this.tokens.get(token);
    return id ? { id, email: `${id}@example.test` } : null;
  }
}


export class FakeAddresses implements AddressRepository {
  rows: (Address & { userId: string })[] = [];
  private n = 0;
  async list(userId: string) { return this.rows.filter((r) => r.userId === userId).map(({ userId: _u, ...a }) => a); }
  async create(userId: string, i: AddressInput) {
    const mine = this.rows.filter((r) => r.userId === userId);
    const row = {
      id: `10000000-0000-4000-8000-${String(++this.n).padStart(12, '0')}`, userId, label: i.label, recipientName: i.recipientName,
      phone: i.phone, line1: i.line1, line2: i.line2 ?? null, city: i.city, lga: i.lga, state: i.state, landmark: i.landmark ?? null,
      postalCode: i.postalCode ?? null, isDefault: mine.length === 0 || i.isDefault === true,
    };
    this.rows.push(row);
    const { userId: _u, ...a } = row;
    return a;
  }
  async replace(userId: string, id: string, i: AddressInput) {
    const row = this.rows.find((r) => r.id === id && r.userId === userId);
    if (!row) throw notFound('Address not found');
    Object.assign(row, { label: i.label, recipientName: i.recipientName, phone: i.phone, line1: i.line1, city: i.city, lga: i.lga, state: i.state });
    const { userId: _u, ...a } = row;
    return a;
  }
  async remove(userId: string, id: string) {
    const idx = this.rows.findIndex((r) => r.id === id && r.userId === userId);
    if (idx < 0) throw notFound('Address not found');
    this.rows.splice(idx, 1);
  }
}

type FakeStore = StoreProfile & { userId: string };

export class FakeSellers implements SellerRepository {
  apps = new Map<string, SellerApplication>();
  objects = new Set<string>();
  follows = new Set<string>();
  calls: { fn: string; args: unknown[] }[] = [];
  stores = new Map<string, FakeStore>([
    ['amaka-crafts', { id: 's1', sellerId: '20000000-0000-4000-8000-000000000001', sellerStatus: 'active', slug: 'amaka-crafts', name: 'Amaka Crafts', tagline: 'Handmade', description: 'Baskets', policies: null, deliveryInfo: null, accent: 'gold', logoUrl: null, coverUrl: null, createdAt: '2026-01-01T00:00:00.000Z', userId: IDS.seller }],
    ['closed-shop', { id: 's2', sellerId: '20000000-0000-4000-8000-000000000002', sellerStatus: 'suspended', slug: 'closed-shop', name: 'Closed Shop', tagline: null, description: null, policies: null, deliveryInfo: null, accent: 'navy', logoUrl: null, coverUrl: null, createdAt: '2026-01-01T00:00:00.000Z', userId: IDS.bob }],
  ]);
  private n = 0;

  async getMyApplication(userId: string) { return this.apps.get(userId) ?? null; }

  async saveApplication(userId: string, d: SellerApplicationDraftInput) {
    const cur = this.apps.get(userId);
    if (cur && !canApplicantSubmit(cur.status)) throw new AppError(409, 'conflict', 'application cannot be edited');
    const app: SellerApplication = {
      id: cur?.id ?? `30000000-0000-4000-8000-${String(++this.n).padStart(12, '0')}`, status: cur?.status ?? 'draft',
      legalName: d.legalName ?? null, businessName: d.businessName ?? null, contactEmail: d.contactEmail ?? null, contactPhone: d.contactPhone ?? null,
      addressLine1: d.addressLine1 ?? null, addressCity: d.addressCity ?? null, addressLga: d.addressLga ?? null, addressState: d.addressState ?? null,
      categories: d.categories ?? [], description: d.description ?? null, idType: d.idType ?? null, bankName: d.bankName ?? null,
      bankAccountNumber: d.bankAccountNumber ?? null, bankAccountName: d.bankAccountName ?? null, reviewerNote: null, submittedAt: null,
      decidedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', documents: cur?.documents ?? [],
    };
    this.apps.set(userId, app);
    return app;
  }

  async submitApplication(userId: string) {
    const app = this.apps.get(userId);
    if (!app) throw notFound('no application to submit');
    if (!canApplicantSubmit(app.status)) throw new AppError(409, 'conflict', 'already submitted');
    const missing = missingForSubmission(app as unknown as Record<string, unknown> & { categories: string[] }, app.documents.map((x) => x.kind));
    if (missing.length) throw badRequest(`application is incomplete: ${missing.join(', ')}`);
    app.status = 'submitted';
    return app;
  }

  async addDocument(userId: string, applicationId: string, doc: NewDocument): Promise<ApplicationDocument> {
    const app = this.apps.get(userId);
    if (!app || app.id !== applicationId) throw notFound('Application not found');
    this.calls.push({ fn: 'addDocument', args: [userId, doc.path] });
    const d: ApplicationDocument = { id: `40000000-0000-4000-8000-${String(++this.n).padStart(12, '0')}`, kind: doc.kind as ApplicationDocument['kind'], originalName: doc.originalName, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes, createdAt: '2026-01-01T00:00:00.000Z' };
    app.documents.push(d);
    return d;
  }

  async removeDocument(userId: string, documentId: string) {
    const app = this.apps.get(userId);
    const idx = app?.documents.findIndex((d) => d.id === documentId) ?? -1;
    if (!app || idx < 0) throw notFound('Document not found');
    app.documents.splice(idx, 1);
  }

  async objectExists(_bucket: 'seller-documents' | 'store-media' | 'product-media', path: string) { return this.objects.has(path); }

  async listApplications(p: { status?: ApplicationStatus; limit: number; offset: number }): Promise<Paged<AdminApplicationRow>> {
    const rows = [...this.apps.entries()].filter(([, a]) => (p.status ? a.status === p.status : a.status !== 'draft'))
      .map(([uid, a]) => ({ id: a.id, status: a.status, legalName: a.legalName, businessName: a.businessName, applicantEmail: `${uid}@example.test`, submittedAt: a.submittedAt, updatedAt: a.updatedAt }));
    return { rows, total: rows.length, limit: p.limit, offset: p.offset };
  }

  async getApplicationDetail(id: string): Promise<AdminApplicationDetail | null> {
    for (const [uid, a] of this.apps) if (a.id === id) return { ...a, applicant: { id: uid, email: `${uid}@example.test`, fullName: 'Applicant' }, events: [] };
    return null;
  }

  async reviewApplication(actorId: string, id: string, action: ReviewAction, note?: string) {
    this.calls.push({ fn: 'reviewApplication', args: [actorId, id, action, note] });
    for (const [uid, a] of this.apps) {
      if (a.id !== id) continue;
      if (uid === actorId) throw forbidden('you cannot review your own application');
      const r = nextStatusForReview(a.status, action, note);
      if (!r.allowed) throw new AppError(409, 'conflict', r.reason);
      a.status = r.to;
      return;
    }
    throw notFound('application not found');
  }

  async listSellers(p: { limit: number; offset: number }): Promise<Paged<AdminSellerRow>> {
    const rows = [...this.stores.values()].map((s) => ({ id: s.sellerId, status: s.sellerStatus, storeName: s.name, storeSlug: s.slug, applicantEmail: `${s.userId}@example.test`, createdAt: s.createdAt }));
    return { rows, total: rows.length, limit: p.limit, offset: p.offset };
  }

  async setSellerStatus(actorId: string, sellerId: string, status: SellerStatus, note?: string) {
    this.calls.push({ fn: 'setSellerStatus', args: [actorId, sellerId, status, note] });
    const s = [...this.stores.values()].find((x) => x.sellerId === sellerId);
    if (!s) throw notFound('seller not found');
    s.sellerStatus = status;
  }

  async getMyStore(userId: string) {
    const s = [...this.stores.values()].find((x) => x.userId === userId);
    if (!s) return null;
    const { userId: _u, ...store } = s;
    return store;
  }

  async updateMyStore(userId: string, i: StoreProfileInput) {
    const s = [...this.stores.values()].find((x) => x.userId === userId);
    if (!s) throw forbidden('Seller account required');
    if (s.sellerStatus !== 'active') throw forbidden('This seller account is suspended');
    Object.assign(s, { name: i.name, tagline: i.tagline ?? null, description: i.description ?? null, policies: i.policies ?? null, deliveryInfo: i.deliveryInfo ?? null, accent: i.accent });
    const { userId: _u, ...store } = s;
    return store;
  }

  async setStoreMedia(userId: string, kind: 'logo' | 'cover', path: string) {
    const s = [...this.stores.values()].find((x) => x.userId === userId);
    if (!s) throw forbidden('Seller account required');
    if (kind === 'logo') s.logoUrl = `https://media.example/${path}`; else s.coverUrl = `https://media.example/${path}`;
    const { userId: _u, ...store } = s;
    return store;
  }

  async listStores(p: { q?: string; limit: number; offset: number }): Promise<Paged<PublicStoreCard>> {
    const rows = [...this.stores.values()].filter((s) => s.sellerStatus === 'active' && (!p.q || s.name.toLowerCase().includes(p.q.toLowerCase())))
      .map((s) => ({ slug: s.slug, name: s.name, tagline: s.tagline, accent: s.accent, logoUrl: s.logoUrl }));
    return { rows, total: rows.length, limit: p.limit, offset: p.offset };
  }

  async getPublicStore(slug: string): Promise<PublicStore | null> {
    const s = this.stores.get(slug);
    if (!s || s.sellerStatus !== 'active') return null;
    return { slug: s.slug, name: s.name, tagline: s.tagline, accent: s.accent, logoUrl: s.logoUrl, description: s.description, policies: s.policies, deliveryInfo: s.deliveryInfo, coverUrl: s.coverUrl, verified: true, followers: [...this.follows].filter((f) => f.endsWith(`:${slug}`)).length, since: s.createdAt };
  }

  async follow(userId: string, slug: string) {
    const s = this.stores.get(slug);
    if (!s || s.sellerStatus !== 'active') throw notFound('Store not found');
    this.follows.add(`${userId}:${slug}`);
  }
  async unfollow(userId: string, slug: string) { this.follows.delete(`${userId}:${slug}`); }
  async listFollowedSlugs(userId: string) { return [...this.follows].filter((f) => f.startsWith(`${userId}:`)).map((f) => f.split(':')[1] as string); }
}

void STATUS_LABELS;

const SELLER_ID = '20000000-0000-4000-8000-000000000001';

export class FakeCatalog implements CatalogRepository {
  products = new Map<string, SellerProduct & { sellerId: string; sellerActive: boolean }>();
  stock = new Map<string, number>();
  calls: { fn: string; args: unknown[] }[] = [];
  categories: Category[] = [
    { id: '50000000-0000-4000-8000-000000000001', parentId: null, slug: 'fashion-clothing', name: 'Fashion and clothing', sortOrder: 10, isActive: true },
  ];
  private n = 0;
  private id(prefix: string) { return `${prefix}0000000-0000-4000-8000-${String(++this.n).padStart(12, '0')}`; }

  seed(over: Partial<SellerProduct> & { sellerId?: string; sellerActive?: boolean }) {
    const id = over.id ?? this.id('6');
    const p = {
      id, slug: over.slug ?? `bag-${this.n}`, name: 'Ankara Tote Bag', description: 'A sturdy handmade tote bag for everyday use.', brand: null, condition: 'new' as const,
      status: 'draft' as ProductStatus, reviewNote: null, categoryId: this.categories[0]?.id ?? null, categoryName: 'Fashion and clothing', weightGrams: 400,
      lengthCm: null, widthCm: null, heightCm: null, shippingRequirements: null, options: [], attributes: {}, priceFromKobo: 1500000, totalStock: 5,
      images: [{ id: this.id('7'), url: 'https://media.example/x.png', altText: null, position: 0 }],
      variants: [{ id: this.id('8'), sku: null, optionValues: {}, priceKobo: 1500000, salePriceKobo: null, stockQuantity: 5, isActive: true }],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', sellerId: SELLER_ID, sellerActive: true, ...over,
    };
    this.products.set(id, p);
    return p;
  }

  async listCategories(): Promise<CategoryNode[]> { return this.categories.filter((c) => c.isActive).map((c) => ({ ...c, children: [] })); }

  async browseProducts(q: BrowseProductsQuery): Promise<Paged<PublicProductCard>> {
    const rows = [...this.products.values()].filter((p) => p.status === 'approved' && p.sellerActive && (!q.q || p.name.toLowerCase().includes(q.q.toLowerCase())))
      .map((p) => ({ slug: p.slug, name: p.name, brand: p.brand, priceFromKobo: p.priceFromKobo, hasSale: false, inStock: p.totalStock > 0, imageUrl: p.images[0]?.url ?? null, storeName: 'Amaka Crafts', storeSlug: 'amaka-crafts' }));
    return { rows, total: rows.length, limit: q.limit, offset: q.offset };
  }

  async getPublicProduct(slug: string): Promise<PublicProduct | null> {
    const p = [...this.products.values()].find((x) => x.slug === slug && x.status === 'approved' && x.sellerActive);
    if (!p) return null;
    return {
      slug: p.slug, name: p.name, description: p.description, brand: p.brand, condition: p.condition, category: { slug: 'fashion-clothing', name: 'Fashion and clothing' },
      options: p.options, attributes: p.attributes, weightGrams: p.weightGrams, shippingRequirements: p.shippingRequirements, images: p.images,
      variants: p.variants.filter((v) => v.isActive).map((v) => ({ id: v.id, optionValues: v.optionValues, priceKobo: v.priceKobo, salePriceKobo: v.salePriceKobo, inStock: v.stockQuantity > 0, lowStock: v.stockQuantity > 0 && v.stockQuantity <= 5 })),
      store: { slug: 'amaka-crafts', name: 'Amaka Crafts', accent: 'gold' },
    };
  }

  private own(sellerId: string, id: string) { const p = this.products.get(id); return p && p.sellerId === sellerId ? p : null; }
  private strip(p: SellerProduct & { sellerId: string; sellerActive: boolean }): SellerProduct { const { sellerId: _s, sellerActive: _a, ...rest } = p; return rest; }

  async listMyProducts(sellerId: string, p: { status?: ProductStatus; limit: number; offset: number }): Promise<Paged<SellerProductRow>> {
    const rows = [...this.products.values()].filter((x) => x.sellerId === sellerId && (!p.status || x.status === p.status))
      .map((x) => ({ id: x.id, slug: x.slug, name: x.name, status: x.status, priceFromKobo: x.priceFromKobo, totalStock: x.totalStock, imageUrl: x.images[0]?.url ?? null, updatedAt: x.updatedAt }));
    return { rows, total: rows.length, limit: p.limit, offset: p.offset };
  }
  async getMyProduct(sellerId: string, id: string) { const p = this.own(sellerId, id); return p ? this.strip(p) : null; }
  async createProduct(sellerId: string, input: CreateProductInput) {
    this.calls.push({ fn: 'createProduct', args: [sellerId, input] });
    const p = this.seed({ sellerId, name: input.name, status: 'draft', images: [], description: input.description ?? null });
    return p.id;
  }
  async updateProduct(sellerId: string, id: string, input: ProductUpdateInput) {
    const p = this.own(sellerId, id);
    if (!p) throw notFound('Product not found');
    if (p.status === 'pending_review') throw new AppError(409, 'conflict', 'withdraw the listing from review before editing it');
    Object.assign(p, { name: input.name, description: input.description ?? null });
    if (p.status === 'approved') p.status = 'pending_review';
    return this.strip(p);
  }
  async changeProductStatus(sellerId: string, id: string, action: SellerProductAction) {
    const p = this.own(sellerId, id);
    if (!p) throw notFound('Product not found');
    const r = nextProductStatusForSeller(p.status, action);
    if (!r.allowed) throw new AppError(409, 'conflict', r.reason);
    if (action === 'submit' && p.images.length === 0) throw badRequest('listing is incomplete: at least one image');
    p.status = r.to;
  }
  async addVariant(sellerId: string, productId: string, input: VariantInput) {
    if (!this.own(sellerId, productId)) throw notFound('Product not found');
    this.calls.push({ fn: 'addVariant', args: [sellerId, productId, input] });
    return this.id('8');
  }
  async updateVariant(sellerId: string, variantId: string, _input: UpdateVariantInput) {
    const found = [...this.products.values()].some((p) => p.sellerId === sellerId && p.variants.some((v) => v.id === variantId));
    if (!found) throw notFound('Variant not found');
  }
  async adjustStock(sellerId: string, variantId: string, delta: number, reason: string) {
    this.calls.push({ fn: 'adjustStock', args: [sellerId, variantId, delta, reason] });
    const owned = [...this.products.values()].find((p) => p.sellerId === sellerId && p.variants.some((v) => v.id === variantId));
    if (!owned) throw notFound('variant not found');
    const v = owned.variants.find((x) => x.id === variantId);
    if (!v) throw notFound('variant not found');
    if (v.stockQuantity + delta < 0) throw new AppError(409, 'conflict', 'insufficient stock');
    v.stockQuantity += delta;
    return v.stockQuantity;
  }
  async listMovements(_s: string, _p: string, _l: number): Promise<StockMovement[]> { return []; }
  async addImage(sellerId: string, productId: string, path: string): Promise<ProductImage> {
    const p = this.own(sellerId, productId);
    if (!p) throw notFound('Product not found');
    const img = { id: this.id('7'), url: `https://media.example/${path}`, altText: null, position: p.images.length };
    p.images.push(img);
    return img;
  }
  async removeImage(sellerId: string, productId: string, imageId: string) {
    const p = this.own(sellerId, productId);
    const idx = p?.images.findIndex((i) => i.id === imageId) ?? -1;
    if (!p || idx < 0) throw notFound('Image not found');
    p.images.splice(idx, 1);
  }
  async listAdminProducts(p: { status?: ProductStatus; limit: number; offset: number }): Promise<Paged<AdminProductRow>> {
    const status = p.status ?? 'pending_review';
    const rows = [...this.products.values()].filter((x) => x.status === status).map((x) => ({ id: x.id, slug: x.slug, name: x.name, status: x.status, storeName: 'Amaka Crafts', submittedAt: null, updatedAt: x.updatedAt }));
    return { rows, total: rows.length, limit: p.limit, offset: p.offset };
  }
  async getAdminProduct(id: string): Promise<AdminProductDetail | null> {
    const p = this.products.get(id);
    return p ? { ...this.strip(p), storeName: 'Amaka Crafts', storeSlug: 'amaka-crafts', events: [] } : null;
  }
  async reviewProduct(actorId: string, id: string, action: ProductReviewAction, note?: string) {
    this.calls.push({ fn: 'reviewProduct', args: [actorId, id, action, note] });
    const p = this.products.get(id);
    if (!p) throw notFound('Product not found');
    const r = nextProductStatusForReview(p.status, action, note);
    if (!r.allowed) throw new AppError(409, 'conflict', r.reason);
    p.status = r.to;
  }
  async listAdminCategories() { return this.categories; }
  async createCategory(actorId: string, name: string, parentId: string | undefined, sortOrder: number) {
    this.calls.push({ fn: 'createCategory', args: [actorId, name, parentId, sortOrder] });
    const id = this.id('5');
    this.categories.push({ id, parentId: parentId ?? null, slug: name.toLowerCase().replace(/\s+/g, '-'), name, sortOrder, isActive: true });
    return id;
  }
  async updateCategory(actorId: string, id: string, input: { name: string; sortOrder: number; isActive: boolean }) {
    this.calls.push({ fn: 'updateCategory', args: [actorId, id, input] });
    const c = this.categories.find((x) => x.id === id);
    if (!c) throw notFound('category not found');
    Object.assign(c, input);
  }
}

interface FakeSub { id: string; orderId: string; status: PhysicalStatus; paid: boolean; deliveredAt: string | null; sellerId: string; buyerId: string; items: { variantId: string; qty: number }[] }

export class FakeOrders implements OrderRepository {
  cart = new Map<string, { id: string; variantId: string; quantity: number }[]>();
  subs = new Map<string, FakeSub>();
  orders = new Map<string, { id: string; number: number; buyerId: string; status: OrderStatus; key: string }>();
  stock = new Map<string, number>([['90000000-0000-4000-8000-000000000001', 5]]);
  calls: { fn: string; args: unknown[] }[] = [];
  swept = 0;
  private n = 0;
  private id(p: string) { return `${p}0000000-0000-4000-8000-${String(++this.n).padStart(12, '0')}`; }

  async getCart(userId: string): Promise<CartView> {
    const items = this.cart.get(userId) ?? [];
    return { groups: items.length ? [{ sellerId: '20000000-0000-4000-8000-000000000001', store: { slug: 'amaka-crafts', name: 'Amaka Crafts' }, subtotalKobo: 0, checkoutReady: true,
      items: items.map((i) => ({ id: i.id, variantId: i.variantId, productSlug: 'x-bag', productName: 'Bag', variantLabel: 'Standard', imageUrl: null, listPriceKobo: 1000, unitPriceKobo: 1000, quantity: i.quantity, lineTotalKobo: 1000 * i.quantity, available: true, maxQuantity: 5, problem: null })) }] : [],
      itemCount: items.reduce((n, i) => n + i.quantity, 0) };
  }
  async addToCart(userId: string, variantId: string, quantity: number) {
    const have = this.stock.get(variantId);
    if (have === undefined) throw notFound('item not found');
    const items = this.cart.get(userId) ?? [];
    const line = items.find((i) => i.variantId === variantId);
    if ((line?.quantity ?? 0) + quantity > have) throw new AppError(409, 'conflict', `only ${have} available`);
    if (line) line.quantity += quantity; else items.push({ id: this.id('a'), variantId, quantity });
    this.cart.set(userId, items);
  }
  async setCartQuantity(userId: string, itemId: string, quantity: number) {
    const line = (this.cart.get(userId) ?? []).find((i) => i.id === itemId);
    if (!line) throw notFound('cart item not found');
    line.quantity = quantity;
  }
  async removeCartItem(userId: string, itemId: string) { this.cart.set(userId, (this.cart.get(userId) ?? []).filter((i) => i.id !== itemId)); }
  async createOrder(userId: string, storeSlug: string, addressId: string, _note: string | undefined, key: string) {
    this.calls.push({ fn: 'createOrder', args: [userId, storeSlug, addressId, key] });
    const existing = [...this.orders.values()].find((o) => o.buyerId === userId && o.key === key);
    if (existing) return existing.id;
    const items = this.cart.get(userId) ?? [];
    if (items.length === 0) throw new AppError(400, 'bad_request', 'there are no items in your cart for this store');
    for (const i of items) this.stock.set(i.variantId, (this.stock.get(i.variantId) ?? 0) - i.quantity);
    const id = this.id('b');
    this.orders.set(id, { id, number: 100000 + this.orders.size + 1, buyerId: userId, status: 'pending_payment', key });
    const sid = this.id('c');
    this.subs.set(sid, { id: sid, orderId: id, status: 'pending_payment', paid: false, deliveredAt: null, sellerId: '20000000-0000-4000-8000-000000000001', buyerId: userId, items: items.map((i) => ({ variantId: i.variantId, qty: i.quantity })) });
    this.cart.set(userId, []);
    return id;
  }
  private detail(orderId: string, actors: ('buyer' | 'staff')[]): OrderDetail | null {
    const o = this.orders.get(orderId);
    if (!o) return null;
    const subs = [...this.subs.values()].filter((s) => s.orderId === orderId);
    return { id: o.id, orderNumber: o.number, status: o.status, totalKobo: 0, subtotalKobo: 0, shippingKobo: 0, currency: 'NGN', note: null, expiresAt: null, paidAt: null, createdAt: '2026-01-01T00:00:00.000Z', itemCount: 1, storeNames: ['Amaka Crafts'],
      shippingAddress: { recipientName: 'R', phone: '+2348031234567', line1: '1 Road', line2: null, city: 'Enugu', lga: 'Enugu North', state: 'Enugu', landmark: null, postalCode: null },
      suborders: subs.map((s) => ({ id: s.id, status: s.status, store: { slug: 'amaka-crafts', name: 'Amaka Crafts' }, subtotalKobo: 0, shippingKobo: 0, totalKobo: 0, deliveredAt: s.deliveredAt, items: [], history: [], actions: availableOrderActions(s.status, actors, { deliveredAt: s.deliveredAt ? new Date(s.deliveredAt) : null }) })) };
  }
  async listOrders(userId: string, p: { limit: number; offset: number }): Promise<Paged<OrderSummary>> {
    const rows = [...this.orders.values()].filter((o) => o.buyerId === userId).map((o) => ({ id: o.id, orderNumber: o.number, status: o.status, totalKobo: 0, itemCount: 1, storeNames: ['Amaka Crafts'], createdAt: '2026-01-01T00:00:00.000Z' }));
    return { rows, total: rows.length, limit: p.limit, offset: p.offset };
  }
  async getOrder(userId: string, id: string) { const o = this.orders.get(id); return o && o.buyerId === userId ? this.detail(id, ['buyer']) : null; }
  async listSellerOrders(sellerId: string, p: { status?: PhysicalStatus; limit: number; offset: number }): Promise<Paged<SellerOrderRow>> {
    const rows = [...this.subs.values()].filter((s) => s.sellerId === sellerId && s.paid).map((s) => ({ id: s.id, orderNumber: this.orders.get(s.orderId)?.number ?? 0, status: s.status, totalKobo: 0, itemCount: 1, createdAt: '2026-01-01T00:00:00.000Z' }));
    return { rows, total: rows.length, limit: p.limit, offset: p.offset };
  }
  async getSellerOrder(sellerId: string, id: string): Promise<SellerOrderDetail | null> {
    const s = this.subs.get(id);
    if (!s || s.sellerId !== sellerId || !s.paid) return null;
    return { id: s.id, orderNumber: this.orders.get(s.orderId)?.number ?? 0, status: s.status, subtotalKobo: 0, shippingKobo: 0, totalKobo: 0, createdAt: '2026-01-01T00:00:00.000Z', deliveredAt: s.deliveredAt, buyer: { name: 'R', phone: '+2348031234567' },
      shippingAddress: { recipientName: 'R', phone: '+2348031234567', line1: '1 Road', line2: null, city: 'Enugu', lga: 'Enugu North', state: 'Enugu', landmark: null, postalCode: null }, note: null, items: [], history: [], actions: availableOrderActions(s.status, ['seller']) };
  }
  async changeStatus(actorId: string, subId: string, action: OrderAction, note?: string) {
    this.calls.push({ fn: 'changeStatus', args: [actorId, subId, action, note] });
    const s = this.subs.get(subId);
    if (!s) throw notFound('order not found');
    const isBuyer = s.buyerId === actorId;
    const isSeller = actorId === IDS.seller && s.sellerId === '20000000-0000-4000-8000-000000000001';
    const isStaff = actorId === IDS.ops || actorId === IDS.carol;
    if (!isBuyer && !isSeller && !isStaff) throw notFound('order not found');
    const actors = [...(isBuyer ? ['buyer' as const] : []), ...(isSeller ? ['seller' as const] : []), ...(isStaff ? ['staff' as const] : [])];
    const r = nextOrderStatus(s.status, action, actors, { deliveredAt: s.deliveredAt ? new Date(s.deliveredAt) : null });
    if (!r.allowed) throw new AppError(r.reason.startsWith('You cannot') ? 403 : 409, r.reason.startsWith('You cannot') ? 'forbidden' : 'conflict', r.reason);
    if (action === 'cancel') for (const i of s.items) this.stock.set(i.variantId, (this.stock.get(i.variantId) ?? 0) + i.qty);
    s.status = r.to;
    if (r.to === 'cancelled') { const o = this.orders.get(s.orderId); if (o) o.status = 'cancelled'; }
    if (r.to === 'delivered') s.deliveredAt = new Date().toISOString();
  }
  async listAdminOrders(p: { status?: OrderStatus; limit: number; offset: number }): Promise<Paged<AdminOrderRow>> {
    const rows = [...this.orders.values()].filter((o) => !p.status || o.status === p.status).map((o) => ({ id: o.id, orderNumber: o.number, status: o.status, buyerEmail: `${o.buyerId}@example.test`, totalKobo: 0, createdAt: '2026-01-01T00:00:00.000Z', expiresAt: null }));
    return { rows, total: rows.length, limit: p.limit, offset: p.offset };
  }
  async getAdminOrder(id: string) { return this.detail(id, ['staff']); }
  async expireUnpaid() { this.swept += 1; return 0; }
}

export function makeDeps(): AppDeps & { users: FakeUsers; addresses: FakeAddresses; sellers: FakeSellers; catalog: FakeCatalog; orders: FakeOrders } {
  return { tokenVerifier: new FakeVerifier(), users: new FakeUsers(), addresses: new FakeAddresses(), sellers: new FakeSellers(), catalog: new FakeCatalog(), orders: new FakeOrders(), logger: createLogger('error', () => undefined) };
}

export const testConfig = {
  CORS_ORIGINS: ['http://localhost:3000'],
  TRUST_PROXY_HOPS: 0,
  RATE_LIMIT_GLOBAL_PER_15_MIN: 1000,
  RATE_LIMIT_ADMIN_WRITES_PER_MIN: 1000,
  RATE_LIMIT_USER_WRITES_PER_MIN: 1000,
};
