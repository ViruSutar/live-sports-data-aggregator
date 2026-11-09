import type { RequestHandler } from 'express';
import { logger } from '../utils/logger.js';

/**
 * Logs incoming HTTP requests with method, URL, status code, and duration.
 */
export const requestLogger: RequestHandler = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(
      {
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: duration,
      },
      'HTTP request completed',
    );
  });

  next();
};
