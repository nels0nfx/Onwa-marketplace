import { AppError, conflict, forbidden, notFound } from './errors.js';

/**
 * Maps PostgreSQL error codes raised by our SQL functions and constraints to API errors.
 * Messages from our own RAISE EXCEPTION calls are safe to show; raw constraint text is not.
 */
export function mapDbError(error: { code?: string; message: string }): AppError {
  const ours = !/violates|relation|column|constraint|duplicate key/i.test(error.message);
  switch (error.code) {
    case '42501': return forbidden(ours ? error.message : undefined);
    case 'P0002': return notFound(ours ? error.message : undefined);
    case '23514': return conflict(ours ? error.message : 'That change is not allowed');
    case '23505': return conflict('That already exists');
    case '22023': return new AppError(400, 'bad_request', ours ? error.message : 'Invalid request');
    default:
      console.error(JSON.stringify({ level: 'error', msg: 'db_error', code: error.code, message: error.message }));
      return new AppError(500, 'internal_error', 'Database error');
  }
}
