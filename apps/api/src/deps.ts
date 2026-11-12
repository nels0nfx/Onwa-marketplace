import type {
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
  objectExists(bucket: 'seller-documents' | 'store-media', path: string): Promise<boolean>;
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

export interface AppDeps {
  tokenVerifier: TokenVerifier;
  users: UserRepository;
  addresses: AddressRepository;
  sellers: SellerRepository;
  logger: Logger;
}
