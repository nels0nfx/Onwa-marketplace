import type { PermissionCode } from './permissions.js';
import type { RoleCode } from './roles.js';

export type AccountStatus = 'active' | 'suspended' | 'deactivated';

export interface Profile {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  avatarUrl: string | null;
  status: AccountStatus;
  createdAt: string;
}

export interface MeResponse {
  profile: Profile;
  roles: RoleCode[];
  permissions: PermissionCode[];
}

export interface AdminUserRow extends Profile {
  roles: RoleCode[];
}

export interface Paged<T> {
  rows: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface RoleSummary {
  code: RoleCode;
  name: string;
  description: string;
  isStaff: boolean;
  permissions: PermissionCode[];
}

export interface AuditLogRow {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; requestId?: string; details?: { field: string; message: string }[] };
}

// ---------------------------------------------------------------- Stage 2
import type { ProductCondition, ProductStatus } from './catalog.js';
import type { ApplicationStatus, DocumentKind, SellerStatus, StoreAccent } from './seller.js';

export interface Address {
  id: string;
  label: string;
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  lga: string;
  state: string;
  landmark: string | null;
  postalCode: string | null;
  isDefault: boolean;
}

export interface ApplicationDocument {
  id: string;
  kind: DocumentKind;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  /** Short-lived signed URL, only present for reviewers. */
  url?: string;
}

export interface SellerApplication {
  id: string;
  status: ApplicationStatus;
  legalName: string | null;
  businessName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  addressLine1: string | null;
  addressCity: string | null;
  addressLga: string | null;
  addressState: string | null;
  categories: string[];
  description: string | null;
  idType: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
  reviewerNote: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
  documents: ApplicationDocument[];
}

export interface ApplicationEvent {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  actorId: string | null;
  createdAt: string;
}

export interface AdminApplicationRow {
  id: string;
  status: ApplicationStatus;
  legalName: string | null;
  businessName: string | null;
  applicantEmail: string;
  submittedAt: string | null;
  updatedAt: string;
}

export interface AdminApplicationDetail extends SellerApplication {
  applicant: { id: string; email: string; fullName: string };
  events: ApplicationEvent[];
}

export interface AdminSellerRow {
  id: string;
  status: SellerStatus;
  storeName: string;
  storeSlug: string;
  applicantEmail: string;
  createdAt: string;
}

export interface StoreProfile {
  id: string;
  sellerId: string;
  sellerStatus: SellerStatus;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  policies: string | null;
  deliveryInfo: string | null;
  accent: StoreAccent;
  logoUrl: string | null;
  coverUrl: string | null;
  createdAt: string;
}

export interface PublicStoreCard {
  slug: string;
  name: string;
  tagline: string | null;
  accent: StoreAccent;
  logoUrl: string | null;
}

export interface PublicStore extends PublicStoreCard {
  description: string | null;
  policies: string | null;
  deliveryInfo: string | null;
  coverUrl: string | null;
  verified: true;
  followers: number;
  since: string;
}

// ---------------------------------------------------------------- Stage 3
export interface Category {
  id: string;
  parentId: string | null;
  slug: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface CategoryNode extends Category {
  children: Category[];
}

export interface ProductImage {
  id: string;
  url: string;
  altText: string | null;
  position: number;
}

export interface SellerVariant {
  id: string;
  sku: string | null;
  optionValues: Record<string, string>;
  priceKobo: number;
  salePriceKobo: number | null;
  stockQuantity: number;
  isActive: boolean;
}

export interface SellerProduct {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  brand: string | null;
  condition: ProductCondition;
  status: ProductStatus;
  reviewNote: string | null;
  categoryId: string | null;
  categoryName: string | null;
  weightGrams: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  shippingRequirements: string | null;
  options: { name: string; values: string[] }[];
  attributes: Record<string, string>;
  priceFromKobo: number | null;
  totalStock: number;
  images: ProductImage[];
  variants: SellerVariant[];
  createdAt: string;
  updatedAt: string;
}

export interface SellerProductRow {
  id: string;
  slug: string;
  name: string;
  status: ProductStatus;
  priceFromKobo: number | null;
  totalStock: number;
  imageUrl: string | null;
  updatedAt: string;
}

export interface StockMovement {
  id: string;
  variantId: string;
  delta: number;
  reason: string;
  quantityAfter: number;
  note: string | null;
  createdAt: string;
}

export interface PublicProductCard {
  slug: string;
  name: string;
  brand: string | null;
  priceFromKobo: number | null;
  hasSale: boolean;
  inStock: boolean;
  imageUrl: string | null;
  storeName: string;
  storeSlug: string;
}

export interface PublicVariant {
  id: string;
  optionValues: Record<string, string>;
  priceKobo: number;
  salePriceKobo: number | null;
  inStock: boolean;
  lowStock: boolean;
}

export interface PublicProduct {
  slug: string;
  name: string;
  description: string | null;
  brand: string | null;
  condition: ProductCondition;
  category: { slug: string; name: string } | null;
  options: { name: string; values: string[] }[];
  attributes: Record<string, string>;
  weightGrams: number | null;
  shippingRequirements: string | null;
  images: ProductImage[];
  variants: PublicVariant[];
  store: { slug: string; name: string; accent: string };
}

export interface AdminProductRow {
  id: string;
  slug: string;
  name: string;
  status: ProductStatus;
  storeName: string;
  submittedAt: string | null;
  updatedAt: string;
}

export interface ProductEvent {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  createdAt: string;
}

export interface AdminProductDetail extends SellerProduct {
  storeName: string;
  storeSlug: string;
  events: ProductEvent[];
}
