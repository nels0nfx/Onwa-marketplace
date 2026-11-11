import { Router } from 'express';

export function healthRoutes(): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'onwa-api', time: new Date().toISOString() });
  });
  return router;
}
