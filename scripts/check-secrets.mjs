#!/usr/bin/env node
/* Scans the working tree for committed secrets and for service-role key leakage into the web app. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'coverage', '.tmp-test', '.vercel']);
const SKIP_FILES = new Set(['package-lock.json', 'check-secrets.mjs']);
const findings = [];

const patterns = [
  [/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/, 'JWT-like token (Supabase keys are JWTs)'],
  [/\bsk_(live|test)_[A-Za-z0-9]{10,}/, 'Paystack-style secret key'],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key block'],
  [/postgres(ql)?:\/\/[^\s:@]+:[^\s@]{3,}@/, 'database URL with password'],
];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) { walk(full); continue; }
    const rel = relative(root, full);
    const name = basename(full);
    if (/^\.env(\..+)?$/.test(name) && name !== '.env.example') findings.push(`${rel}: real .env file present (must not be committed or zipped)`);
    if (SKIP_FILES.has(name) || st.size > 1_000_000 || /\.(png|jpg|jpeg|gif|webp|ico|zip)$/i.test(name)) continue;
    const text = readFileSync(full, 'utf8');
    for (const [re, label] of patterns) if (re.test(text)) findings.push(`${rel}: ${label}`);
    if (rel.startsWith(join('apps', 'web'))) {
      if (/SERVICE_ROLE/i.test(text)) findings.push(`${rel}: references SERVICE_ROLE inside apps/web (must stay server-side in apps/api)`);
    }
    if (/NEXT_PUBLIC_[A-Z_]*(SECRET|SERVICE|PRIVATE)[A-Z_]*/.test(text) && !rel.endsWith('check-secrets.mjs')) {
      findings.push(`${rel}: NEXT_PUBLIC_ variable name suggests a secret`);
    }
  }
}

walk(root);
if (findings.length) {
  console.error('Secret check FAILED:\n - ' + findings.join('\n - '));
  process.exit(1);
}
console.log('Secret check passed: no committed secrets or service-role references in apps/web.');
