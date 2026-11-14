import type {
  AdminOrderRow, CartView, OrderAction, OrderDetail, OrderStatus, OrderSummary, PhysicalStatus, SellerOrderDetail, SellerOrderRow,
  AdminProductDetail, AdminProductRow, BrowseProductsQuery, Category, CategoryNode, CreateProductInput, ProductImage,
  ProductReviewAction, ProductStatus, ProductUpdateInput, PublicProduct, PublicProductCard, SellerProduct, SellerProductAction,
  SellerProductRow, StockMovement, UpdateVariantInput, VariantInput,
  AdminApplicationDetail, AdminApplicationRow, AdminSellerRow, AdminUserRow, Address, AddressInput, ApplicationDocument,
  ApplicationStatus, AuditLogRow, Paged, PermissionCode, Profile, PublicStore, PublicStoreCard, ReviewAction, RoleCode,
  RoleSummary, SellerApplication, SellerApplicationDraftInput, SellerStatus, StoreProfile, StoreProfileInput,
} from '@onwa/shared';
import type { Logger } from './lib/logger.js';

export interface VerifiedUser {
  id: string;
  email: string | null;
}

/** Verifies a Supabase access token. Returns null when the token is invalid or expired. */
export interface TokenVerifier {
  verify(accessToken: string): Promise<VerifiedUser | null>;
}

export interface UserAccess {
  roles: RoleCode[];
  permissions: PermissionCode[];
}

export interface UserRepository {
  getProfile(userId: string): Promise<Profile | null>;
  updateProfile(userId: string, patch: { fullName?: string; phone?: string | null }): Promise<Profile>;
  getAccess(userId: string): Promise<UserAccess>;
  listUsers(params: { q?: string; limit: number; offset: number }): Promise<Paged<AdminUserRow>>;
  listRoles(): Promise<RoleSummary[]>;
  assignRole(actorId: string, targetId: string, role: RoleCode): Promise<void>;
  revokeRole(actorId: string, targetId: string, role: RoleCode): Promise<void>;
  listAuditLogs(params: { limit: number; offset: number }): Promise<Paged<AuditLogRow>>;
}

export interface AddressRepository {
  list(userId: string): Promise<Address[]>;
  create(userId: string, input: AddressInput): Promise<Address>;
  replace(userId: string, id: string, input: AddressInput): Promise<Address>;
  remove(userId: string, id: string): Promise<void>;
}

export interface NewDocument {
  kind: string;
  path: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface SellerRepository {
  // applicant
  getMyApplication(userId: string): Promise<SellerApplication | null>;
  saveApplication(userId: string, draft: SellerApplicationDraftInput): Promise<SellerApplication>;
  submitApplication(userId: string): Promise<SellerApplication>;
  addDocument(userId: string, applicationId: string, doc: NewDocument): Promise<ApplicationDocument>;
  removeDocument(userId: string, documentId: string): Promise<void>;
  objectExists(bucket: 'seller-documents' | 'store-media' | 'product-media', path: string): Promise<boolean>;
  // reviewer
  listApplications(params: { status?: ApplicationStatus; limit: number; offset: number }): Promise<Paged<AdminApplicationRow>>;
  getApplicationDetail(id: string): Promise<AdminApplicationDetail | null>;
  reviewApplication(actorId: string, id: string, action: ReviewAction, note?: string): Promise<void>;
  listSellers(params: { limit: number; offset: number }): Promise<Paged<AdminSellerRow>>;
  setSellerStatus(actorId: string, sellerId: string, status: SellerStatus, note?: string): Promise<void>;
  // seller's own store
  getMyStore(userId: string): Promise<StoreProfile | null>;
  updateMyStore(userId: string, input: StoreProfileInput): Promise<StoreProfile>;
  setStoreMedia(userId: string, kind: 'logo' | 'cover', path: string): Promise<StoreProfile>;
  // public storefronts
  listStores(params: { q?: string; limit: number; offset: number }): Promise<Paged<PublicStoreCard>>;
  getPublicStore(slug: string): Promise<PublicStore | null>;
  follow(userId: string, slug: string): Promise<void>;
  unfollow(userId: string, slug: string): Promise<void>;
  listFollowedSlugs(userId: string): Promise<string[]>;
}

export interface CatalogRepository {
  // public
  listCategories(): Promise<CategoryNode[]>;
  browseProducts(q: BrowseProductsQuery): Promise<Paged<PublicProductCard>>;
  getPublicProduct(slug: string): Promise<PublicProduct | null>;
  // seller (every call is scoped to the seller id)
  listMyProducts(sellerId: string, p: { status?: ProductStatus; limit: number; offset: number }): Promise<Paged<SellerProductRow>>;
  getMyProduct(sellerId: string, id: string): Promise<SellerProduct | null>;
  createProduct(sellerId: string, input: CreateProductInput): Promise<string>;
  updateProduct(sellerId: string, id: string, input: ProductUpdateInput): Promise<SellerProduct>;
  changeProductStatus(sellerId: string, id: string, action: SellerProductAction): Promise<void>;
  addVariant(sellerId: string, productId: string, input: VariantInput): Promise<string>;
  updateVariant(sellerId: string, variantId: string, input: UpdateVariantInput): Promise<void>;
  adjustStock(sellerId: string, variantId: string, delta: number, reason: string, note?: string): Promise<number>;
  listMovements(sellerId: string, productId: string, limit: number): Promise<StockMovement[]>;
  addImage(sellerId: string, productId: string, path: string, altText?: string): Promise<ProductImage>;
  removeImage(sellerId: string, productId: string, imageId: string): Promise<void>;
  // staff
  listAdminProducts(p: { status?: ProductStatus; limit: number; offset: number }): Promise<Paged<AdminProductRow>>;
  getAdminProduct(id: string): Promise<AdminProductDetail | null>;
  reviewProduct(actorId: string, id: string, action: ProductReviewAction, note?: string): Promise<void>;
  listAdminCategories(): Promise<Category[]>;
  createCategory(actorId: string, name: string, parentId: string | undefined, sortOrder: number): Promise<string>;
  updateCategory(actorId: string, id: string, input: { name: string; sortOrder: number; isActive: boolean }): Promise<void>;
}

export interface OrderRepository {
  getCart(userId: string): Promise<CartView>;
  addToCart(userId: string, variantId: string, quantity: number): Promise<void>;
  setCartQuantity(userId: string, itemId: string, quantity: number): Promise<void>;
  removeCartItem(userId: string, itemId: string): Promise<void>;
  createOrder(userId: string, storeSlug: string, addressId: string, note: string | undefined, idempotencyKey: string): Promise<string>;
  listOrders(userId: string, p: { limit: number; offset: number }): Promise<Paged<OrderSummary>>;
  getOrder(userId: string, id: string): Promise<OrderDetail | null>;
  listSellerOrders(sellerId: string, p: { status?: PhysicalStatus; limit: number; offset: number }): Promise<Paged<SellerOrderRow>>;
  getSellerOrder(sellerId: string, id: string): Promise<SellerOrderDetail | null>;
  changeStatus(actorId: string, sellerOrderId: string, action: OrderAction, note?: string): Promise<void>;
  listAdminOrders(p: { status?: OrderStatus; limit: number; offset: number }): Promise<Paged<AdminOrderRow>>;
  getAdminOrder(id: string): Promise<OrderDetail | null>;
  expireUnpaid(): Promise<number>;
}

export interface AppDeps {
  tokenVerifier: TokenVerifier;
  users: UserRepository;
  addresses: AddressRepository;
  sellers: SellerRepository;
  catalog: CatalogRepository;
  orders: OrderRepository;
  logger: Logger;
}
