import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AdminApplicationDetail, AdminApplicationRow, AdminSellerRow, ApplicationDocument, ApplicationEvent, ApplicationStatus,
  DocumentKind, Paged, PublicStore, PublicStoreCard, ReviewAction, SellerApplication, SellerApplicationDraftInput,
  SellerStatus, StoreAccent, StoreProfile, StoreProfileInput,
} from '@onwa/shared';
import type { NewDocument, SellerRepository } from '../../deps.js';
import { mapDbError } from '../../lib/dbErrors.js';
import { forbidden, notFound } from '../../lib/errors.js';

const DOC_BUCKET = 'seller-documents';
const MEDIA_BUCKET = 'store-media';
const SIGNED_URL_SECONDS = 300;

interface DocRow { id: string; kind: DocumentKind; original_name: string; mime_type: string; size_bytes: number; created_at: string; storage_path?: string }
interface AppRow {
  id: string; user_id: string; status: ApplicationStatus; legal_name: string | null; business_name: string | null;
  contact_email: string | null; contact_phone: string | null; address_line1: string | null; address_city: string | null;
  address_lga: string | null; address_state: string | null; categories: string[]; description: string | null;
  id_type: string | null; bank_name: string | null; bank_account_number: string | null; bank_account_name: string | null;
  reviewer_note: string | null; submitted_at: string | null; decided_at: string | null; created_at: string; updated_at: string;
  seller_application_documents?: DocRow[];
}
interface StoreRow {
  id: string; seller_id: string; slug: string; name: string; tagline: string | null; description: string | null;
  policies: string | null; delivery_info: string | null; accent: StoreAccent; logo_path: string | null; cover_path: string | null; created_at: string;
}

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

const toDoc = (d: DocRow): ApplicationDocument => ({
  id: d.id, kind: d.kind, originalName: d.original_name, mimeType: d.mime_type, sizeBytes: d.size_bytes, createdAt: d.created_at,
});

const APP_SELECT = '*, seller_application_documents(id,kind,original_name,mime_type,size_bytes,created_at,storage_path)';

function toApplication(r: AppRow): SellerApplication {
  return {
    id: r.id, status: r.status, legalName: r.legal_name, businessName: r.business_name, contactEmail: r.contact_email,
    contactPhone: r.contact_phone, addressLine1: r.address_line1, addressCity: r.address_city, addressLga: r.address_lga,
    addressState: r.address_state, categories: r.categories ?? [], description: r.description, idType: r.id_type,
    bankName: r.bank_name, bankAccountNumber: r.bank_account_number, bankAccountName: r.bank_account_name,
    reviewerNote: r.reviewer_note, submittedAt: r.submitted_at, decidedAt: r.decided_at, createdAt: r.created_at, updatedAt: r.updated_at,
    documents: [...(r.seller_application_documents ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)).map(toDoc),
  };
}

export class SupabaseSellerRepository implements SellerRepository {
  constructor(private readonly db: SupabaseClient, private readonly supabaseUrl: string) {}

  private mediaUrl(path: string | null): string | null {
    return path ? `${this.supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${MEDIA_BUCKET}/${path}` : null;
  }

  private toStoreProfile(row: StoreRow, sellerStatus: SellerStatus): StoreProfile {
    return {
      id: row.id, sellerId: row.seller_id, sellerStatus, slug: row.slug, name: row.name, tagline: row.tagline,
      description: row.description, policies: row.policies, deliveryInfo: row.delivery_info, accent: row.accent,
      logoUrl: this.mediaUrl(row.logo_path), coverUrl: this.mediaUrl(row.cover_path), createdAt: row.created_at,
    };
  }

  // ------------------------------------------------------------ applicant
  async getMyApplication(userId: string): Promise<SellerApplication | null> {
    const { data, error } = await this.db.from('seller_applications').select(APP_SELECT)
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw mapDbError(error);
    return data ? toApplication(data as unknown as AppRow) : null;
  }

  async saveApplication(userId: string, draft: SellerApplicationDraftInput): Promise<SellerApplication> {
    const { error } = await this.db.rpc('save_seller_application', { p_user: userId, p: { ...draft, categories: draft.categories ?? [] } });
    if (error) throw mapDbError(error);
    const app = await this.getMyApplication(userId);
    if (!app) throw notFound('Application not found');
    return app;
  }

  async submitApplication(userId: string): Promise<SellerApplication> {
    const { error } = await this.db.rpc('submit_seller_application', { p_user: userId });
    if (error) throw mapDbError(error);
    const app = await this.getMyApplication(userId);
    if (!app) throw notFound('Application not found');
    return app;
  }

  async addDocument(userId: string, applicationId: string, doc: NewDocument): Promise<ApplicationDocument> {
    const { data: owner, error: ownerError } = await this.db.from('seller_applications').select('id')
      .eq('id', applicationId).eq('user_id', userId).maybeSingle();
    if (ownerError) throw mapDbError(ownerError);
    if (!owner) throw notFound('Application not found');
    const { data, error } = await this.db.from('seller_application_documents').insert({
      application_id: applicationId, kind: doc.kind, storage_path: doc.path, original_name: doc.originalName,
      mime_type: doc.mimeType, size_bytes: doc.sizeBytes,
    }).select('id,kind,original_name,mime_type,size_bytes,created_at').single();
    if (error) throw mapDbError(error);
    return toDoc(data as DocRow);
  }

  async removeDocument(userId: string, documentId: string): Promise<void> {
    const { data, error } = await this.db.from('seller_application_documents')
      .select('id, storage_path, seller_applications!inner(user_id, status)').eq('id', documentId).maybeSingle();
    if (error) throw mapDbError(error);
    const row = data as unknown as { id: string; storage_path: string; seller_applications: { user_id: string; status: string } | { user_id: string; status: string }[] } | null;
    const parent = one(row?.seller_applications);
    if (!row || !parent || parent.user_id !== userId) throw notFound('Document not found');
    if (!['draft', 'more_info_required'].includes(parent.status)) throw forbidden('The application can no longer be edited');
    const del = await this.db.from('seller_application_documents').delete().eq('id', documentId);
    if (del.error) throw mapDbError(del.error);
    await this.db.storage.from(DOC_BUCKET).remove([row.storage_path]);
  }

  async objectExists(bucket: 'seller-documents' | 'store-media' | 'product-media', path: string): Promise<boolean> {
    const slash = path.lastIndexOf('/');
    const dir = path.slice(0, slash);
    const file = path.slice(slash + 1);
    const { data, error } = await this.db.storage.from(bucket).list(dir, { limit: 10, search: file });
    if (error) return false;
    return (data ?? []).some((o) => o.name === file);
  }

  // ------------------------------------------------------------ reviewer
  async listApplications(params: { status?: ApplicationStatus; limit: number; offset: number }): Promise<Paged<AdminApplicationRow>> {
    let q = this.db.from('seller_applications')
      .select('id,status,legal_name,business_name,submitted_at,updated_at, profiles!seller_applications_user_id_fkey(email)', { count: 'exact' });
    q = params.status ? q.eq('status', params.status) : q.neq('status', 'draft');
    const { data, error, count } = await q.order('updated_at', { ascending: false }).range(params.offset, params.offset + params.limit - 1);
    if (error) throw mapDbError(error);
    type R = { id: string; status: ApplicationStatus; legal_name: string | null; business_name: string | null; submitted_at: string | null; updated_at: string; profiles: { email: string } | { email: string }[] | null };
    const rows = ((data ?? []) as unknown as R[]).map((r) => ({
      id: r.id, status: r.status, legalName: r.legal_name, businessName: r.business_name,
      applicantEmail: one(r.profiles)?.email ?? '', submittedAt: r.submitted_at, updatedAt: r.updated_at,
    }));
    return { rows, total: count ?? rows.length, limit: params.limit, offset: params.offset };
  }

  async getApplicationDetail(id: string): Promise<AdminApplicationDetail | null> {
    const { data, error } = await this.db.from('seller_applications')
      .select(`${APP_SELECT}, profiles!seller_applications_user_id_fkey(id,email,full_name)`).eq('id', id).maybeSingle();
    if (error) throw mapDbError(error);
    if (!data) return null;
    const row = data as unknown as AppRow & { profiles: { id: string; email: string; full_name: string } | { id: string; email: string; full_name: string }[] };
    const app = toApplication(row);

    const docRows = row.seller_application_documents ?? [];
    if (docRows.length > 0) {
      const { data: signed } = await this.db.storage.from(DOC_BUCKET).createSignedUrls(docRows.map((d) => d.storage_path ?? ''), SIGNED_URL_SECONDS);
      const byPath = new Map((signed ?? []).map((s) => [s.path ?? '', s.signedUrl]));
      app.documents = app.documents.map((d) => {
        const src = docRows.find((r) => r.id === d.id);
        const url = src?.storage_path ? byPath.get(src.storage_path) : undefined;
        return url ? { ...d, url } : d;
      });
    }

    const ev = await this.db.from('seller_application_events').select('id,from_status,to_status,note,actor_id,created_at')
      .eq('application_id', id).order('created_at', { ascending: true });
    if (ev.error) throw mapDbError(ev.error);
    const events: ApplicationEvent[] = ((ev.data ?? []) as { id: string; from_status: string | null; to_status: string; note: string | null; actor_id: string | null; created_at: string }[])
      .map((e) => ({ id: e.id, fromStatus: e.from_status, toStatus: e.to_status, note: e.note, actorId: e.actor_id, createdAt: e.created_at }));

    const applicant = one(row.profiles);
    return { ...app, applicant: { id: applicant?.id ?? '', email: applicant?.email ?? '', fullName: applicant?.full_name ?? '' }, events };
  }

  async reviewApplication(actorId: string, id: string, action: ReviewAction, note?: string): Promise<void> {
    const { error } = await this.db.rpc('review_seller_application', { p_actor: actorId, p_application: id, p_action: action, p_note: note ?? null });
    if (error) throw mapDbError(error);
  }

  async listSellers(params: { limit: number; offset: number }): Promise<Paged<AdminSellerRow>> {
    const { data, error, count } = await this.db.from('sellers')
      .select('id,status,created_at, stores(name,slug), profiles!sellers_user_id_fkey(email)', { count: 'exact' })
      .order('created_at', { ascending: false }).range(params.offset, params.offset + params.limit - 1);
    if (error) throw mapDbError(error);
    type R = { id: string; status: SellerStatus; created_at: string; stores: { name: string; slug: string } | { name: string; slug: string }[] | null; profiles: { email: string } | { email: string }[] | null };
    const rows = ((data ?? []) as unknown as R[]).map((r) => ({
      id: r.id, status: r.status, storeName: one(r.stores)?.name ?? '', storeSlug: one(r.stores)?.slug ?? '',
      applicantEmail: one(r.profiles)?.email ?? '', createdAt: r.created_at,
    }));
    return { rows, total: count ?? rows.length, limit: params.limit, offset: params.offset };
  }

  async setSellerStatus(actorId: string, sellerId: string, status: SellerStatus, note?: string): Promise<void> {
    const { error } = await this.db.rpc('set_seller_status', { p_actor: actorId, p_seller: sellerId, p_status: status, p_note: note ?? null });
    if (error) throw mapDbError(error);
  }

  // ------------------------------------------------------------ seller's own store
  private async loadOwnStore(userId: string): Promise<{ store: StoreRow; sellerStatus: SellerStatus } | null> {
    const { data, error } = await this.db.from('sellers').select('id,status, stores(*)').eq('user_id', userId).maybeSingle();
    if (error) throw mapDbError(error);
    if (!data) return null;
    const row = data as unknown as { id: string; status: SellerStatus; stores: StoreRow | StoreRow[] | null };
    const store = one(row.stores);
    return store ? { store, sellerStatus: row.status } : null;
  }

  async getMyStore(userId: string): Promise<StoreProfile | null> {
    const own = await this.loadOwnStore(userId);
    return own ? this.toStoreProfile(own.store, own.sellerStatus) : null;
  }

  async updateMyStore(userId: string, input: StoreProfileInput): Promise<StoreProfile> {
    const own = await this.loadOwnStore(userId);
    if (!own) throw forbidden('Seller account required');
    if (own.sellerStatus !== 'active') throw forbidden('This seller account is suspended');
    const { data, error } = await this.db.from('stores').update({
      name: input.name, tagline: input.tagline ?? null, description: input.description ?? null,
      policies: input.policies ?? null, delivery_info: input.deliveryInfo ?? null, accent: input.accent,
    }).eq('id', own.store.id).select('*').single();
    if (error) throw mapDbError(error);
    return this.toStoreProfile(data as StoreRow, own.sellerStatus);
  }

  async setStoreMedia(userId: string, kind: 'logo' | 'cover', path: string): Promise<StoreProfile> {
    const own = await this.loadOwnStore(userId);
    if (!own) throw forbidden('Seller account required');
    if (own.sellerStatus !== 'active') throw forbidden('This seller account is suspended');
    const previous = kind === 'logo' ? own.store.logo_path : own.store.cover_path;
    const { data, error } = await this.db.from('stores').update(kind === 'logo' ? { logo_path: path } : { cover_path: path })
      .eq('id', own.store.id).select('*').single();
    if (error) throw mapDbError(error);
    if (previous && previous !== path) await this.db.storage.from(MEDIA_BUCKET).remove([previous]);
    return this.toStoreProfile(data as StoreRow, own.sellerStatus);
  }

  // ------------------------------------------------------------ public storefronts
  async listStores(params: { q?: string; limit: number; offset: number }): Promise<Paged<PublicStoreCard>> {
    let q = this.db.from('stores').select('slug,name,tagline,accent,logo_path, sellers!inner(status)', { count: 'exact' })
      .eq('sellers.status', 'active');
    if (params.q) q = q.or(`name.ilike.%${params.q}%,tagline.ilike.%${params.q}%`);
    const { data, error, count } = await q.order('created_at', { ascending: false }).range(params.offset, params.offset + params.limit - 1);
    if (error) throw mapDbError(error);
    const rows = ((data ?? []) as unknown as { slug: string; name: string; tagline: string | null; accent: StoreAccent; logo_path: string | null }[])
      .map((r) => ({ slug: r.slug, name: r.name, tagline: r.tagline, accent: r.accent, logoUrl: this.mediaUrl(r.logo_path) }));
    return { rows, total: count ?? rows.length, limit: params.limit, offset: params.offset };
  }

  private async findActiveStore(slug: string): Promise<(StoreRow & { sellers: { created_at: string } | { created_at: string }[] }) | null> {
    const { data, error } = await this.db.from('stores').select('*, sellers!inner(status, created_at)')
      .eq('slug', slug).eq('sellers.status', 'active').maybeSingle();
    if (error) throw mapDbError(error);
    return (data as unknown as (StoreRow & { sellers: { created_at: string } | { created_at: string }[] }) | null) ?? null;
  }

  async getPublicStore(slug: string): Promise<PublicStore | null> {
    const row = await this.findActiveStore(slug);
    if (!row) return null;
    const { count, error } = await this.db.from('store_follows').select('*', { count: 'exact', head: true }).eq('store_id', row.id);
    if (error) throw mapDbError(error);
    return {
      slug: row.slug, name: row.name, tagline: row.tagline, accent: row.accent, logoUrl: this.mediaUrl(row.logo_path),
      description: row.description, policies: row.policies, deliveryInfo: row.delivery_info, coverUrl: this.mediaUrl(row.cover_path),
      verified: true, followers: count ?? 0, since: one(row.sellers)?.created_at ?? row.created_at,
    };
  }

  async follow(userId: string, slug: string): Promise<void> {
    const store = await this.findActiveStore(slug);
    if (!store) throw notFound('Store not found');
    const { error } = await this.db.from('store_follows').upsert({ user_id: userId, store_id: store.id }, { onConflict: 'user_id,store_id', ignoreDuplicates: true });
    if (error) throw mapDbError(error);
  }

  async unfollow(userId: string, slug: string): Promise<void> {
    const { data, error } = await this.db.from('stores').select('id').eq('slug', slug).maybeSingle();
    if (error) throw mapDbError(error);
    if (!data) return;
    const del = await this.db.from('store_follows').delete().eq('user_id', userId).eq('store_id', (data as { id: string }).id);
    if (del.error) throw mapDbError(del.error);
  }

  async listFollowedSlugs(userId: string): Promise<string[]> {
    const { data, error } = await this.db.from('store_follows').select('stores(slug)').eq('user_id', userId).limit(200);
    if (error) throw mapDbError(error);
    return ((data ?? []) as unknown as { stores: { slug: string } | { slug: string }[] | null }[])
      .map((r) => one(r.stores)?.slug).filter((s): s is string => typeof s === 'string');
  }
}
