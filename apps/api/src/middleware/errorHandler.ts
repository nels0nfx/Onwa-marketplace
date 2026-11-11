import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from '../lib/logger.js';
import { AppError, notFound } from '../lib/errors.js';

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(notFound('Route not found'));

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const requestId = req.requestId;
    if (err instanceof AppError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, requestId, details: err.details } });
      return;
    }
    // body-parser errors (malformed JSON, payload too large)
    const status = typeof err?.status === 'number' ? err.status : undefined;
    if (status === 400 || status === 413) {
      res.status(status).json({
        error: { code: status === 413 ? 'payload_too_large' : 'bad_request', message: status === 413 ? 'Request body is too large' : 'Malformed request body', requestId },
      });
      return;
    }
    logger.error('unhandled_error', { requestId, path: req.path, message: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong on our side', requestId } });
  };
}
