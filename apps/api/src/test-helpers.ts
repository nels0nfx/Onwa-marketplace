import type {
  AdminApplicationDetail, AdminApplicationRow, AdminSellerRow, AdminUserRow, Address, AddressInput, ApplicationDocument,
  ApplicationStatus, AuditLogRow, Paged, PermissionCode, Profile, PublicStore, PublicStoreCard, ReviewAction, RoleCode,
  RoleSummary, SellerApplication, SellerApplicationDraftInput, SellerStatus, StoreProfile, StoreProfileInput,
} from '@onwa/shared';
import { ROLE_DEFINITIONS, ROLE_PERMISSIONS, STATUS_LABELS, canApplicantSubmit, missingForSubmission, nextStatusForReview } from '@onwa/shared';
import type { AddressRepository, AppDeps, NewDocument, SellerRepository, TokenVerifier, UserAccess, UserRepository } from './deps.js';
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
    ['tok-manager', IDS.manager], ['tok-seller', IDS.seller],
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

  async objectExists(_bucket: 'seller-documents' | 'store-media', path: string) { return this.objects.has(path); }

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

export function makeDeps(): AppDeps & { users: FakeUsers; addresses: FakeAddresses; sellers: FakeSellers } {
  return { tokenVerifier: new FakeVerifier(), users: new FakeUsers(), addresses: new FakeAddresses(), sellers: new FakeSellers(), logger: createLogger('error', () => undefined) };
}

export const testConfig = {
  CORS_ORIGINS: ['http://localhost:3000'],
  TRUST_PROXY_HOPS: 0,
  RATE_LIMIT_GLOBAL_PER_15_MIN: 1000,
  RATE_LIMIT_ADMIN_WRITES_PER_MIN: 1000,
  RATE_LIMIT_USER_WRITES_PER_MIN: 1000,
};
