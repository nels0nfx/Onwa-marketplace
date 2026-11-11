export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: { field: string; message: string }[],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message = 'Bad request', details?: AppError['details']) => new AppError(400, 'bad_request', message, details);
export const validationError = (details: NonNullable<AppError['details']>) => new AppError(400, 'validation_error', 'Some fields are invalid', details);
export const unauthorized = (message = 'Authentication required') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have permission to do this') => new AppError(403, 'forbidden', message);
export const notFound = (message = 'Not found') => new AppError(404, 'not_found', message);
export const conflict = (message = 'Conflict') => new AppError(409, 'conflict', message);
export const tooManyRequests = (message = 'Too many requests') => new AppError(429, 'rate_limited', message);
