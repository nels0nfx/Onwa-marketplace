import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { Env } from './config/env.js';
import type { AppDeps } from './deps.js';
import { authenticate } from './middleware/authenticate.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createRateLimiters } from './middleware/rateLimit.js';
import { requestId } from './middleware/requestId.js';
import { adminRoutes } from './modules/admin/routes.js';
import { healthRoutes } from './modules/health/routes.js';
import { meRoutes } from './modules/users/routes.js';

export type AppConfig = Pick<Env, 'CORS_ORIGINS' | 'TRUST_PROXY_HOPS' | 'RATE_LIMIT_GLOBAL_PER_15_MIN' | 'RATE_LIMIT_ADMIN_WRITES_PER_MIN'>;

/** Builds the Express app. All I/O comes in through `deps`, so tests can inject fakes. */
export function createApp(deps: AppDeps, config: AppConfig): Express {
  const app = express();
  app.disable('x-powered-by');
  if (config.TRUST_PROXY_HOPS > 0) app.set('trust proxy', config.TRUST_PROXY_HOPS);

  const limits = createRateLimiters(config);

  app.use(requestId);
  app.use((req, res, next) => { const start = Date.now(); res.on('finish', () => { if (req.path !== '/api/v1/health') deps.logger.info('request', { method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start }); }); next(); });
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => {
        // Non-browser clients (no Origin header) are allowed; browsers must match the allow-list.
        if (!origin || config.CORS_ORIGINS.includes(origin)) return cb(null, true);
        cb(null, false);
      },
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type'],
      maxAge: 600,
    }),
  );
  app.use(limits.global);
  app.use(express.json({ limit: '100kb' }));

  const v1 = express.Router();
  v1.use(healthRoutes());
  v1.use(authenticate(deps));
  v1.use(meRoutes(deps));
  v1.use(adminRoutes(deps, limits));
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler(deps.logger));
  return app;
}
