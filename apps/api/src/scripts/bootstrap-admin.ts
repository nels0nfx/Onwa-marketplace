/**
 * One-time bootstrap of the first super_admin.
 *   npm run admin:bootstrap -- you@example.com
 * The account must already exist (register on the website and confirm the email first).
 * The SQL function refuses to run once any super_admin exists.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { emailSchema } from '@onwa/shared';
import { loadEnv } from '../config/env.js';

const emailArg = process.argv[2];
const parsed = emailSchema.safeParse(emailArg ?? '');
if (!parsed.success) {
  console.error('Usage: npm run admin:bootstrap -- <email-of-existing-account>');
  process.exit(1);
}

const env = loadEnv(process.env);
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const { error } = await db.rpc('bootstrap_super_admin', { p_email: parsed.data });
if (error) {
  console.error(`Bootstrap failed: ${error.message}`);
  process.exit(1);
}
console.log(`Done. ${parsed.data} is now a super_admin. Sign out and in again on the website.`);
