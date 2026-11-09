import dotenv from 'dotenv';
dotenv.config();

import { createServer } from 'node:http';
import { createApp } from './app.js';
import { createDatabase, seedDatabase } from './database/connection.js';
import { createPoller } from './modules/providers/provider-b/provider-b.poller.js';
import { getEnv } from './config/env.js';
import { logger } from './common/utils/logger.js';

/**
 * Application entry point.
 * Startup sequence:
 * 1. Load environment variables (dotenv)
 * 2. Create and initialize database (migrations)
 * 3. Seed match data (idempotent)
 * 4. Create Express app
 * 5. Start HTTP server
 * 6. Start Provider B poller (if configured)
 * 7. Register graceful shutdown handlers
 */
function startServer(): void {
  const env = getEnv();

  // Initialize database with migrations
  const db = createDatabase(env.DB_PATH);

  // Seed initial data (idempotent — safe on restarts)
  seedDatabase(db);

  // Create Express app with provider precedence
  const app = createApp(db, {
    primaryProvider: env.PRIMARY_PROVIDER,
  });

  // Create HTTP server
  const server = createServer(app);

  // Start Provider B poller if base URL is configured
  const poller = env.PROVIDER_B_BASE_URL
    ? createPoller(db, {
        baseUrl: env.PROVIDER_B_BASE_URL,
        intervalMs: env.POLL_INTERVAL_MS,
      })
    : undefined;

  // Start listening
  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'Match aggregator listening');

    if (poller) {
      poller.start();
    } else {
      logger.info('Provider B polling disabled (PROVIDER_B_BASE_URL not set)');
    }
  });

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Received shutdown signal');

    // 1. Stop the poller
    const pollerStopped = poller?.stop() ?? Promise.resolve();

    // 2. Stop accepting new connections
    server.close((error) => {
      void pollerStopped.then(() => {
        if (error) {
          logger.error({ error }, 'HTTP server shutdown error');
          process.exitCode = 1;
        }
        // 3. Close database
        db.close();
        logger.info('Shutdown complete');
      });
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Prevent unhandled promise rejections from crashing
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });
}

startServer();
