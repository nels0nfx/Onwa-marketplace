import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { SupabaseAddressRepository } from './modules/addresses/supabaseAddressRepository.js';
import { SupabaseCatalogRepository } from './modules/catalog/supabaseCatalogRepository.js';
import { SupabaseOrderRepository } from './modules/orders/supabaseOrderRepository.js';
import { SupabaseSellerRepository } from './modules/sellers/supabaseSellerRepository.js';
import { SupabaseTokenVerifier, SupabaseUserRepository } from './modules/users/supabaseUserRepository.js';

const env = loadEnv(process.env);
const logger = createLogger(env.LOG_LEVEL);

// The service-role client bypasses RLS. It lives only in this process and is never sent to a browser.
const serviceClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const app = createApp(
  {
    tokenVerifier: new SupabaseTokenVerifier(serviceClient),
    users: new SupabaseUserRepository(serviceClient),
    addresses: new SupabaseAddressRepository(serviceClient),
    sellers: new SupabaseSellerRepository(serviceClient, env.SUPABASE_URL),
    catalog: new SupabaseCatalogRepository(serviceClient, env.SUPABASE_URL),
    orders: new SupabaseOrderRepository(serviceClient, env.SUPABASE_URL),
    logger,
  },
  env,
);

const server = app.listen(env.PORT, () => logger.info('onwa-api listening', { port: env.PORT, env: env.NODE_ENV }));

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    logger.info('shutting down', { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
