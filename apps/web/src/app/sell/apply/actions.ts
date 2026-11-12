'use server';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import {
  DOCUMENT_KINDS, DOCUMENT_TYPES, EXTENSION_BY_TYPE, MAX_DOCUMENT_BYTES, MIME_BY_TYPE, canApplicantSubmit, safeFileName,
  sellerApplicationDraftSchema, uuidSchema, type SellerApplication,
} from '@onwa/shared';
import { ApiError, apiRequest } from '@/lib/api';
import { firstIssueField } from '@/lib/messages';
import { requireSession } from '@/lib/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { checkUpload } from '@/lib/uploads';

const PATH = '/sell/apply';
const str = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');
const back = (kind: 'm' | 'e', code: string) => redirect(`${PATH}?${kind}=${code}`);

export async function saveApplicationAction(formData: FormData) {
  const { token } = await requireSession(PATH);
  const fields = ['legalName', 'businessName', 'contactEmail', 'contactPhone', 'addressLine1', 'addressCity', 'addressLga', 'addressState',
    'description', 'idType', 'bankName', 'bankAccountNumber', 'bankAccountName'] as const;
  const raw: Record<string, unknown> = {};
  for (const f of fields) raw[f] = str(formData.get(f));
  raw.categories = formData.getAll('categories').filter((v): v is string => typeof v === 'string');

  const parsed = sellerApplicationDraftSchema.safeParse(raw);
  if (!parsed.success) redirect(`${PATH}?e=validation&f=${firstIssueField(parsed.error.issues)}`);

  let outcome: { kind: 'm' | 'e'; code: string } = { kind: 'm', code: 'draft_saved' };
  try {
    await apiRequest('/seller/application', { token, method: 'PUT', body: parsed.data });
    if (str(formData.get('intent')) === 'submit') {
      await apiRequest('/seller/application/submit', { token, method: 'POST' });
      outcome = { kind: 'm', code: 'submitted' };
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 400 && str(formData.get('intent')) === 'submit') outcome = { kind: 'e', code: 'incomplete' };
    else if (e instanceof ApiError && (e.status === 409 || e.status === 403)) outcome = { kind: 'e', code: 'locked' };
    else outcome = { kind: 'e', code: 'service_error' };
  }
  back(outcome.kind, outcome.code);
}

export async function uploadDocumentAction(formData: FormData) {
  const { userId, token } = await requireSession(PATH);
  const kind = str(formData.get('kind'));
  if (!(DOCUMENT_KINDS as readonly string[]).includes(kind)) back('e', 'service_error');

  const file = await checkUpload(formData.get('file'), DOCUMENT_TYPES, MAX_DOCUMENT_BYTES);
  if (!file.ok) back('e', file.code);
  if (!file.ok) return; // narrows the type; back() never returns

  let outcome = { kind: 'm' as 'm' | 'e', code: 'document_added' };
  try {
    const { application } = await apiRequest<{ application: SellerApplication | null }>('/seller/application', { token });
    if (!application) { outcome = { kind: 'e', code: 'service_error' }; }
    else if (!canApplicantSubmit(application.status)) { outcome = { kind: 'e', code: 'locked' }; }
    else {
      const path = `${userId}/${application.id}/${randomUUID()}.${EXTENSION_BY_TYPE[file.type]}`;
      const supabase = await createSupabaseServerClient();
      const up = await supabase.storage.from('seller-documents').upload(path, file.bytes, { contentType: MIME_BY_TYPE[file.type], upsert: false });
      if (up.error) { outcome = { kind: 'e', code: 'upload_failed' }; }
      else {
        try {
          await apiRequest('/seller/application/documents', {
            token, method: 'POST',
            body: { kind, path, originalName: safeFileName(file.name), mimeType: MIME_BY_TYPE[file.type], sizeBytes: file.size },
          });
        } catch (e) {
          await supabase.storage.from('seller-documents').remove([path]);
          outcome = { kind: 'e', code: e instanceof ApiError && e.status === 403 ? 'locked' : 'upload_failed' };
        }
      }
    }
  } catch {
    outcome = { kind: 'e', code: 'service_error' };
  }
  back(outcome.kind, outcome.code);
}

export async function removeDocumentAction(formData: FormData) {
  const { token } = await requireSession(PATH);
  const id = uuidSchema.safeParse(str(formData.get('id')));
  if (!id.success) back('e', 'not_found');
  let code = 'document_removed';
  let kind: 'm' | 'e' = 'm';
  try {
    if (id.success) await apiRequest(`/seller/application/documents/${id.data}`, { token, method: 'DELETE' });
  } catch (e) {
    kind = 'e';
    code = e instanceof ApiError && e.status === 403 ? 'locked' : e instanceof ApiError && e.status === 404 ? 'not_found' : 'service_error';
  }
  back(kind, code);
}
