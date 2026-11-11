export type Tone = 'error' | 'success' | 'info';

const MESSAGES: Record<string, { tone: Tone; text: string }> = {
  invalid_credentials: { tone: 'error', text: 'Email or password is incorrect.' },
  email_not_confirmed: { tone: 'error', text: 'Confirm your email address first. Check your inbox for the link we sent.' },
  register_failed: { tone: 'error', text: 'We could not create that account. Try a different email or sign in.' },
  callback_failed: { tone: 'error', text: 'That link is invalid or has expired. Request a new one.' },
  reset_failed: { tone: 'error', text: 'We could not update your password. Request a new reset link and try again.' },
  service_error: { tone: 'error', text: 'Something went wrong on our side. Try again in a moment.' },
  forbidden_action: { tone: 'error', text: 'You do not have permission to make that change.' },
  not_found: { tone: 'error', text: 'That account or role no longer exists.' },
  conflict_action: { tone: 'error', text: 'That change would break a platform safety rule, so it was not made.' },
  check_email: { tone: 'info', text: 'Check your inbox. We sent a confirmation link to finish creating your account.' },
  reset_sent: { tone: 'info', text: 'If that email has an account, a reset link is on its way.' },
  profile_saved: { tone: 'success', text: 'Profile saved.' },
  password_updated: { tone: 'success', text: 'Password updated.' },
  role_granted: { tone: 'success', text: 'Role granted.' },
  role_revoked: { tone: 'success', text: 'Role revoked.' },
};

const FIELD_MESSAGES: Record<string, string> = {
  fullName: 'Enter your full name using letters, spaces, apostrophes, dots or hyphens.',
  email: 'Enter a valid email address.',
  password: 'Use at least 10 characters, with an uppercase letter, a lowercase letter and a number.',
  confirmPassword: 'The two passwords do not match.',
  acceptTerms: 'Accept the terms to continue.',
  phone: 'Enter a valid phone number, for example 0803 123 4567.',
};

export function resolveMessage(code?: string, field?: string): { tone: Tone; text: string } | null {
  if (code === 'validation') {
    return { tone: 'error', text: (field && FIELD_MESSAGES[field]) || 'Check the highlighted details and try again.' };
  }
  return code ? (MESSAGES[code] ?? null) : null;
}

export function firstIssueField(issues: { path: PropertyKey[] }[]): string {
  const first = issues[0]?.path[0];
  return typeof first === 'string' ? first : 'form';
}
