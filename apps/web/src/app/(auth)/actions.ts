'use server';
import { redirect } from 'next/navigation';
import {
  forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema, safeRedirectPath,
} from '@onwa/shared';
import { siteUrl } from '@/lib/env';
import { firstIssueField } from '@/lib/messages';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const str = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');

export async function loginAction(formData: FormData) {
  const next = safeRedirectPath(str(formData.get('next')));
  const nextQ = `&next=${encodeURIComponent(next)}`;
  const parsed = loginSchema.safeParse({ email: str(formData.get('email')), password: str(formData.get('password')) });
  if (!parsed.success) redirect(`/login?e=validation&f=${firstIssueField(parsed.error.issues)}${nextQ}`);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // Never reveal whether the email exists: only an unconfirmed email gets its own message.
    redirect(`/login?e=${error.code === 'email_not_confirmed' ? 'email_not_confirmed' : 'invalid_credentials'}${nextQ}`);
  }
  redirect(next);
}

export async function registerAction(formData: FormData) {
  const parsed = registerSchema.safeParse({
    fullName: str(formData.get('fullName')),
    email: str(formData.get('email')),
    password: str(formData.get('password')),
    confirmPassword: str(formData.get('confirmPassword')),
    acceptTerms: formData.get('acceptTerms') ?? undefined,
  });
  if (!parsed.success) redirect(`/register?e=validation&f=${firstIssueField(parsed.error.issues)}`);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName }, // copied to the profile by a trigger; roles are never taken from metadata
      emailRedirectTo: `${siteUrl()}/auth/callback?next=/account`,
    },
  });
  if (error) redirect(error.code === 'weak_password' ? '/register?e=validation&f=password' : '/register?e=register_failed');
  if (data.session) redirect('/account');
  redirect('/login?m=check_email');
}

export async function forgotPasswordAction(formData: FormData) {
  const parsed = forgotPasswordSchema.safeParse({ email: str(formData.get('email')) });
  if (!parsed.success) redirect('/forgot-password?e=validation&f=email');
  const supabase = await createSupabaseServerClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo: `${siteUrl()}/auth/callback?next=/reset-password` });
  redirect('/forgot-password?m=reset_sent'); // same response whether or not the account exists
}

export async function resetPasswordAction(formData: FormData) {
  const parsed = resetPasswordSchema.safeParse({ password: str(formData.get('password')), confirmPassword: str(formData.get('confirmPassword')) });
  if (!parsed.success) redirect(`/reset-password?e=validation&f=${firstIssueField(parsed.error.issues)}`);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) redirect('/reset-password?e=reset_failed');
  redirect('/account?m=password_updated');
}
