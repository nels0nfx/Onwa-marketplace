export type Tone = 'error' | 'success' | 'info';

const MESSAGES: Record<string, { tone: Tone; text: string }> = {
  invalid_credentials: { tone: 'error', text: 'Email or password is incorrect.' },
  email_not_confirmed: { tone: 'error', text: 'Confirm your email address first. Check your inbox for the link we sent.' },
  register_failed: { tone: 'error', text: 'We could not create that account. Try a different email or sign in.' },
  callback_failed: { tone: 'error', text: 'That link is invalid or has expired. Request a new one.' },
  reset_failed: { tone: 'error', text: 'We could not update your password. Request a new reset link and try again.' },
  service_error: { tone: 'error', text: 'Something went wrong on our side. Try again in a moment.' },
  forbidden_action: { tone: 'error', text: 'You do not have permission to make that change.' },
  not_found: { tone: 'error', text: 'That item no longer exists.' },
  conflict_action: { tone: 'error', text: 'That change is not allowed right now, so it was not made.' },
  locked: { tone: 'error', text: 'This application can no longer be edited.' },
  no_file: { tone: 'error', text: 'Choose a file to upload.' },
  file_too_large: { tone: 'error', text: 'That file is too large.' },
  file_type: { tone: 'error', text: 'That file type is not accepted. Use the formats listed under the upload field.' },
  upload_failed: { tone: 'error', text: 'The upload failed. Try again.' },
  incomplete: { tone: 'error', text: 'Your application is not complete yet. See "Still needed" below.' },
  check_email: { tone: 'info', text: 'Check your inbox. We sent a confirmation link to finish creating your account.' },
  reset_sent: { tone: 'info', text: 'If that email has an account, a reset link is on its way.' },
  profile_saved: { tone: 'success', text: 'Profile saved.' },
  password_updated: { tone: 'success', text: 'Password updated.' },
  role_granted: { tone: 'success', text: 'Role granted.' },
  role_revoked: { tone: 'success', text: 'Role revoked.' },
  address_saved: { tone: 'success', text: 'Address saved.' },
  address_deleted: { tone: 'success', text: 'Address deleted.' },
  draft_saved: { tone: 'success', text: 'Draft saved.' },
  submitted: { tone: 'success', text: 'Application submitted. We will review it and update the status here.' },
  document_added: { tone: 'success', text: 'Document uploaded.' },
  document_removed: { tone: 'success', text: 'Document removed.' },
  store_saved: { tone: 'success', text: 'Store details saved.' },
  media_saved: { tone: 'success', text: 'Image updated.' },
  decision_done: { tone: 'success', text: 'Decision recorded.' },
  seller_status_done: { tone: 'success', text: 'Seller status updated.' },
};

const FIELD_MESSAGES: Record<string, string> = {
  fullName: 'Enter your full name using letters, spaces, apostrophes, dots or hyphens.',
  email: 'Enter a valid email address.',
  password: 'Use at least 10 characters, with an uppercase letter, a lowercase letter and a number.',
  confirmPassword: 'The two passwords do not match.',
  acceptTerms: 'Accept the terms to continue.',
  phone: 'Enter a valid phone number, for example 0803 123 4567.',
  label: 'Give the address a short label, such as Home or Office.',
  recipientName: 'Enter the recipient\'s full name.',
  line1: 'Enter the street address.',
  line2: 'Address line 2 is too long.',
  city: 'Enter the city or town.',
  lga: 'Enter the local government area.',
  state: 'Choose a state.',
  landmark: 'The landmark is too long.',
  postalCode: 'Postal codes have 6 digits.',
  legalName: 'Enter your legal name.',
  businessName: 'Enter your business or trading name.',
  contactEmail: 'Enter a valid contact email.',
  contactPhone: 'Enter a valid contact phone number.',
  addressLine1: 'Enter the business address.',
  addressCity: 'Enter the business city or town.',
  addressLga: 'Enter the business LGA.',
  addressState: 'Choose the business state.',
  categories: 'Choose between 1 and 6 selling categories.',
  description: 'Describe your business in at least 30 characters (maximum 1000).',
  idType: 'Choose an identity document type.',
  bankName: 'Enter your bank name.',
  bankAccountNumber: 'Bank account numbers have exactly 10 digits.',
  bankAccountName: 'Enter the account name.',
  name: 'Enter a store name (2 to 80 characters).',
  tagline: 'The tagline is too long (maximum 120 characters).',
  policies: 'Store policies are too long (maximum 2000 characters).',
  deliveryInfo: 'Delivery information is too long (maximum 1000 characters).',
  accent: 'Choose one of the listed accent colours.',
  note: 'Add a note of at least 5 characters.',
};

export function resolveMessage(code?: string, field?: string): { tone: Tone; text: string } | null {
  if (code === 'validation') {
    return { tone: 'error', text: (field && FIELD_MESSAGES[field]) || 'Check the details and try again.' };
  }
  return code ? (MESSAGES[code] ?? null) : null;
}

export function firstIssueField(issues: { path: PropertyKey[] }[]): string {
  const first = issues[0]?.path[0];
  return typeof first === 'string' ? first : 'form';
}
