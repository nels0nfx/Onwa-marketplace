import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  APPLICATION_STATUSES, REVIEW_ACTIONS, availableReviewActions, canApplicantSubmit, missingForSubmission, nextStatusForReview,
} from './seller.js';
import { NG_STATES } from './nigeria.js';
import { MAX_DOCUMENT_BYTES, safeFileName, sniffFileType } from './files.js';
import {
  addressSchema, documentRecordSchema, listStoresQuerySchema, reviewDecisionSchema, sellerApplicationDraftSchema,
  sellerApplicationSubmitSchema, sellerStatusChangeSchema, storeProfileSchema,
} from './validation.js';

const here = dirname(fileURLToPath(import.meta.url));
const sqlAll = ['0008_addresses.sql', '0009_sellers.sql'].map((f) => readFileSync(resolve(here, '../../../supabase/migrations', f), 'utf8')).join('\n');

test('review workflow: valid path draft->submitted->under_review->approved', () => {
  assert.deepEqual(nextStatusForReview('submitted', 'start_review'), { allowed: true, to: 'under_review' });
  assert.deepEqual(nextStatusForReview('under_review', 'approve'), { allowed: true, to: 'approved' });
  assert.deepEqual(nextStatusForReview('under_review', 'request_info', 'Please upload a clearer ID'), { allowed: true, to: 'more_info_required' });
  assert.deepEqual(nextStatusForReview('submitted', 'reject', 'Unable to verify identity'), { allowed: true, to: 'rejected' });
});

test('review workflow: illegal transitions are refused', () => {
  assert.equal(nextStatusForReview('draft', 'approve').allowed, false);
  assert.equal(nextStatusForReview('submitted', 'approve').allowed, false, 'approval requires under_review');
  assert.equal(nextStatusForReview('approved', 'reject', 'too late now').allowed, false);
  assert.equal(nextStatusForReview('rejected', 'start_review').allowed, false);
  assert.equal(nextStatusForReview('more_info_required', 'approve').allowed, false);
});

test('review workflow: notes are mandatory for request_info and reject', () => {
  assert.equal(nextStatusForReview('under_review', 'request_info').allowed, false);
  assert.equal(nextStatusForReview('under_review', 'request_info', '   ').allowed, false);
  assert.equal(nextStatusForReview('under_review', 'reject', 'no').allowed, false);
  assert.equal(nextStatusForReview('under_review', 'approve').allowed, true);
});

test('every status has a defined, finite set of reviewer actions; applicants can submit only when editable', () => {
  for (const s of APPLICATION_STATUSES) {
    for (const a of availableReviewActions(s)) assert.ok(REVIEW_ACTIONS.includes(a));
  }
  assert.deepEqual(availableReviewActions('approved'), []);
  assert.deepEqual(availableReviewActions('rejected'), []);
  assert.deepEqual(availableReviewActions('submitted').sort(), ['reject', 'start_review']);
  assert.equal(canApplicantSubmit('draft'), true);
  assert.equal(canApplicantSubmit('more_info_required'), true);
  for (const s of ['submitted', 'under_review', 'approved', 'rejected'] as const) assert.equal(canApplicantSubmit(s), false, s);
});

test('SQL statuses and states match the TypeScript constants', () => {
  for (const s of APPLICATION_STATUSES) assert.ok(sqlAll.includes(`'${s}'`), `status ${s} missing in SQL`);
  for (const st of NG_STATES) assert.ok(sqlAll.includes(`'${st}'`), `state ${st} missing in SQL`);
  assert.equal(NG_STATES.length, 37);
});

const fullApp = {
  legalName: 'Amaka Okafor', businessName: 'Amaka Crafts', contactEmail: 'amaka@example.com', contactPhone: '08031234567',
  addressLine1: '12 Market Road', addressCity: 'Enugu', addressLga: 'Enugu North', addressState: 'Enugu',
  categories: ['Art and crafts'], description: 'We make handmade baskets and decor from locally sourced materials.',
  idType: 'nin', bankName: 'Access Bank', bankAccountNumber: '0123456789', bankAccountName: 'Amaka Okafor',
};

test('submit schema accepts a complete application and normalises phone', () => {
  const r = sellerApplicationSubmitSchema.safeParse(fullApp);
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.contactPhone, '+2348031234567');
});

test('submit schema rejects bad bank numbers, short descriptions, unknown states/categories, extra keys', () => {
  assert.equal(sellerApplicationSubmitSchema.safeParse({ ...fullApp, bankAccountNumber: '12345' }).success, false);
  assert.equal(sellerApplicationSubmitSchema.safeParse({ ...fullApp, description: 'too short' }).success, false);
  assert.equal(sellerApplicationSubmitSchema.safeParse({ ...fullApp, addressState: 'Atlantis' }).success, false);
  assert.equal(sellerApplicationSubmitSchema.safeParse({ ...fullApp, categories: ['Weapons'] }).success, false);
  assert.equal(sellerApplicationSubmitSchema.safeParse({ ...fullApp, categories: [] }).success, false);
  assert.equal(sellerApplicationSubmitSchema.safeParse({ ...fullApp, status: 'approved' }).success, false);
});

test('draft schema: empty strings are dropped, partial drafts are accepted, status cannot be smuggled', () => {
  const r = sellerApplicationDraftSchema.safeParse({ legalName: 'Amaka Okafor', businessName: '', contactEmail: '', bankAccountNumber: '' });
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.legalName, 'Amaka Okafor');
    assert.equal(r.data.businessName, undefined);
    assert.equal(r.data.contactEmail, undefined);
  }
  assert.equal(sellerApplicationDraftSchema.safeParse({}).success, true);
  assert.equal(sellerApplicationDraftSchema.safeParse({ status: 'approved' }).success, false);
  assert.equal(sellerApplicationDraftSchema.safeParse({ bankAccountNumber: '123' }).success, false);
});

test('missingForSubmission lists exactly what is missing, including the identity upload', () => {
  assert.deepEqual(missingForSubmission(fullApp, ['identity']), []);
  const m = missingForSubmission({ ...fullApp, businessName: '', bankName: undefined as unknown as string, categories: [] }, ['proof_of_address']);
  assert.ok(m.includes('Business or trading name') && m.includes('Bank name'));
  assert.ok(m.includes('At least one selling category') && m.includes('An identity document upload'));
});

test('addresses: valid Nigerian address, phone normalised, optional fields blank-safe', () => {
  const r = addressSchema.safeParse({
    label: '', recipientName: 'Chika Obi', phone: '0803 123 4567', line1: '5 Ada George Road', line2: '', city: 'Port Harcourt',
    lga: 'Obio-Akpor', state: 'Rivers', landmark: '', postalCode: '500272',
  });
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.phone, '+2348031234567');
    assert.equal(r.data.label, 'Home');
    assert.equal(r.data.line2, undefined);
  }
  assert.equal(addressSchema.safeParse({ recipientName: 'Chika Obi', phone: 'x', line1: '5 Road', city: 'PH', lga: 'Obio', state: 'Rivers' }).success, false);
  assert.equal(addressSchema.safeParse({ recipientName: 'Chika Obi', phone: '08031234567', line1: '5 Road', city: 'PH', lga: 'Obio', state: 'Texas' }).success, false);
  assert.equal(addressSchema.safeParse({ recipientName: 'Chika Obi', phone: '08031234567', line1: '5 Road', city: 'PH', lga: 'Obio', state: 'Rivers', postalCode: '12' }).success, false);
  assert.equal(addressSchema.safeParse({ recipientName: 'Chika Obi', phone: '08031234567', line1: '5 Road', city: 'PH', lga: 'Obio', state: 'Rivers', userId: 'x' }).success, false);
});

test('review decision and seller status schemas enforce notes', () => {
  assert.equal(reviewDecisionSchema.safeParse({ decision: 'approve' }).success, true);
  assert.equal(reviewDecisionSchema.safeParse({ decision: 'reject' }).success, false);
  assert.equal(reviewDecisionSchema.safeParse({ decision: 'reject', note: 'Identity could not be verified' }).success, true);
  assert.equal(reviewDecisionSchema.safeParse({ decision: 'hack', note: 'whatever note' }).success, false);
  assert.equal(sellerStatusChangeSchema.safeParse({ status: 'active' }).success, true);
  assert.equal(sellerStatusChangeSchema.safeParse({ status: 'suspended' }).success, false);
  assert.equal(sellerStatusChangeSchema.safeParse({ status: 'suspended', note: 'Repeated policy violations' }).success, true);
});

test('store profile: plain text only fields, fixed accent list', () => {
  assert.equal(storeProfileSchema.safeParse({ name: 'Amaka Crafts', accent: 'gold' }).success, true);
  assert.equal(storeProfileSchema.safeParse({ name: 'Amaka Crafts', accent: '#ff0000' }).success, false);
  assert.equal(storeProfileSchema.safeParse({ name: 'A', accent: 'gold' }).success, false);
  assert.equal(storeProfileSchema.safeParse({ name: 'Amaka Crafts', accent: 'gold', customCss: 'x' }).success, false);
  assert.equal(storeProfileSchema.safeParse({ name: 'Amaka Crafts', accent: 'gold', description: 'x'.repeat(1001) }).success, false);
});

test('document record schema bounds size and MIME type', () => {
  const base = { kind: 'identity', path: 'user/app/file.pdf', originalName: 'id.pdf', mimeType: 'application/pdf', sizeBytes: 1000 };
  assert.equal(documentRecordSchema.safeParse(base).success, true);
  assert.equal(documentRecordSchema.safeParse({ ...base, mimeType: 'text/html' }).success, false);
  assert.equal(documentRecordSchema.safeParse({ ...base, sizeBytes: MAX_DOCUMENT_BYTES + 1 }).success, false);
  assert.equal(documentRecordSchema.safeParse({ ...base, kind: 'selfie' }).success, false);
});

test('file sniffing identifies real types and rejects disguised files', () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
  const html = new TextEncoder().encode('<script>alert(1)</script>');
  const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);
  assert.equal(sniffFileType(pdf), 'pdf');
  assert.equal(sniffFileType(jpg), 'jpeg');
  assert.equal(sniffFileType(png), 'png');
  assert.equal(sniffFileType(webp), 'webp');
  assert.equal(sniffFileType(html), null);
  assert.equal(sniffFileType(exe), null);
  assert.equal(sniffFileType(new Uint8Array([])), null);
  assert.equal(sniffFileType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x41, 0x56, 0x49, 0x20])), null, 'RIFF but not WEBP');
});

test('safeFileName strips paths and control characters', () => {
  assert.equal(safeFileName('../../etc/passwd'), 'passwd');
  assert.equal(safeFileName('C:\\Users\\me\\id card.pdf'), 'id card.pdf');
  assert.equal(safeFileName('<img src=x onerror=1>.png'), 'img srcx onerror1.png');
  assert.equal(safeFileName('///'), 'file');
  assert.ok(safeFileName('x'.repeat(500)).length <= 120);
});

test('listStoresQuerySchema sanitises search and bounds paging', () => {
  assert.equal(listStoresQuerySchema.parse({ q: 'a,b)%' }).q, 'ab');
  assert.equal(listStoresQuerySchema.parse({}).limit, 24);
  assert.equal(listStoresQuerySchema.safeParse({ limit: '999' }).success, false);
});
