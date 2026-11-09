import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors/app-error.js';
import { logger } from '../utils/logger.js';

/**
 * Centralized Express error handler.
 * Maps known error types to appropriate HTTP responses.
 * Never exposes database internals or stack traces to clients.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  // Zod validation errors → 400
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      details: err.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  // Application errors with known status codes
  if (err instanceof AppError) {
    if (!err.isOperational) {
      logger.error({ err }, 'Non-operational application error');
    }
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  // Express body-parser errors (e.g., JSON parse failure, body too large)
  if (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    typeof (err as Record<string, unknown>).status === 'number'
  ) {
    const status = (err as Record<string, unknown>).status as number;
    const message = status === 413 ? 'Request body too large' : 'Invalid request body';
    res.status(status).json({ error: message });
    return;
  }

  // Unexpected errors → 500
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
};
