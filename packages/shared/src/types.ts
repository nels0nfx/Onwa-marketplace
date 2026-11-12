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
