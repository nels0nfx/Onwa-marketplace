export const APPLICATION_STATUSES = ['draft', 'submitted', 'under_review', 'more_info_required', 'approved', 'rejected'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const SELLER_STATUSES = ['active', 'suspended'] as const;
export type SellerStatus = (typeof SELLER_STATUSES)[number];

/** Statuses in which the applicant may edit the application and its documents. */
export const EDITABLE_STATUSES: readonly ApplicationStatus[] = ['draft', 'more_info_required'];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under review',
  more_info_required: 'More information required',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const REVIEW_ACTIONS = ['start_review', 'request_info', 'approve', 'reject'] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export const REVIEW_TRANSITIONS: Record<ReviewAction, { from: readonly ApplicationStatus[]; to: ApplicationStatus; noteRequired: boolean }> = {
  start_review: { from: ['submitted'], to: 'under_review', noteRequired: false },
  request_info: { from: ['under_review'], to: 'more_info_required', noteRequired: true },
  approve: { from: ['under_review'], to: 'approved', noteRequired: false },
  reject: { from: ['submitted', 'under_review'], to: 'rejected', noteRequired: true },
};

export type TransitionResult = { allowed: true; to: ApplicationStatus } | { allowed: false; reason: string };

/** Mirrors public.review_seller_application. The database remains the final authority. */
export function nextStatusForReview(current: ApplicationStatus, action: ReviewAction, note?: string | null): TransitionResult {
  const rule = REVIEW_TRANSITIONS[action];
  if (!rule.from.includes(current)) {
    return { allowed: false, reason: `Cannot ${action.replace('_', ' ')} an application that is ${STATUS_LABELS[current].toLowerCase()}` };
  }
  if (rule.noteRequired && (note ?? '').trim().length < 5) {
    return { allowed: false, reason: 'A note of at least 5 characters is required for this decision' };
  }
  return { allowed: true, to: rule.to };
}

export function canApplicantSubmit(status: ApplicationStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

/** Actions a reviewer can take from a status, for building admin UI buttons. */
export function availableReviewActions(status: ApplicationStatus): ReviewAction[] {
  return REVIEW_ACTIONS.filter((a) => REVIEW_TRANSITIONS[a].from.includes(status));
}

export const SELLER_CATEGORY_OPTIONS = [
  'Fashion and clothing', 'Beauty and personal care', 'Electronics and gadgets', 'Home and living',
  'Food and groceries', 'Health and wellness', 'Books and stationery', 'Art and crafts',
  'Digital products', 'Professional services', 'Home services', 'Events and entertainment', 'Other',
] as const;

export const ID_TYPES = [
  { code: 'nin', label: 'National Identification Number (NIN) slip or card' },
  { code: 'drivers_licence', label: "Driver's licence" },
  { code: 'voters_card', label: "Voter's card" },
  { code: 'intl_passport', label: 'International passport' },
] as const;
export const ID_TYPE_CODES = ['nin', 'drivers_licence', 'voters_card', 'intl_passport'] as const;

export const DOCUMENT_KINDS = ['identity', 'business_registration', 'proof_of_address', 'other'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  identity: 'Identity document',
  business_registration: 'Business registration (optional)',
  proof_of_address: 'Proof of address (optional)',
  other: 'Other supporting document',
};

export const STORE_ACCENTS = ['gold', 'obsidian', 'forest', 'burgundy', 'navy'] as const;
export type StoreAccent = (typeof STORE_ACCENTS)[number];

export const REQUIRED_APPLICATION_FIELDS = [
  ['legalName', 'Legal name'], ['businessName', 'Business or trading name'], ['contactEmail', 'Contact email'],
  ['contactPhone', 'Contact phone'], ['addressLine1', 'Business address'], ['addressCity', 'City'],
  ['addressLga', 'LGA'], ['addressState', 'State'], ['description', 'Business description'],
  ['idType', 'Identity document type'], ['bankName', 'Bank name'], ['bankAccountNumber', 'Bank account number'],
  ['bankAccountName', 'Bank account name'],
] as const;

/** Human-readable list of what is still missing before an application can be submitted. */
export function missingForSubmission(
  app: Record<string, unknown> & { categories?: readonly string[] },
  documentKinds: readonly string[],
): string[] {
  const missing: string[] = [];
  for (const [key, label] of REQUIRED_APPLICATION_FIELDS) {
    const v = app[key];
    if (typeof v !== 'string' || v.trim() === '') missing.push(label);
  }
  if (!app.categories || app.categories.length === 0) missing.push('At least one selling category');
  if (!documentKinds.includes('identity')) missing.push('An identity document upload');
  return missing;
}
