import express, { type Express } from 'express';
import type { DatabaseHandle } from './database/connection.js';
import type { Provider } from './common/types/index.js';
import { requestLogger } from './common/middleware/request-logger.js';
import { errorHandler } from './common/middleware/error-handler.js';
import { createProviderARoutes } from './modules/providers/provider-a/provider-a.routes.js';
import { createMatchRoutes } from './modules/matches/match.routes.js';
import { MatchService } from './modules/matches/match.service.js';

export interface AppOptions {
  primaryProvider?: Provider;
}

/**
 * Creates and configures the Express application.
 * Mounts webhook routes, client-facing routes, and error handling middleware.
 */
export function createApp(db: DatabaseHandle, options: AppOptions = {}): Express {
  const app = express();

  // Disable Express fingerprint header
  app.disable('x-powered-by');

  // Parse JSON bodies with size limit
  app.use(express.json({ limit: '256kb' }));

  // Request logging
  app.use(requestLogger);

  // Provider A webhook routes
  app.use(createProviderARoutes(db));

  // Client-facing match routes
  const matchService = new MatchService(db, options.primaryProvider);
  app.use(createMatchRoutes(matchService));

  // 404 handler for unmatched routes
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Centralized error handler
  app.use(errorHandler);

  return app;
}
