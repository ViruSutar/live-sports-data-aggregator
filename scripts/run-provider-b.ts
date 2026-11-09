/**
 * Script to run the mock Provider B HTTP service.
 *
 * Usage:
 *   npx tsx scripts/run-provider-b.ts
 *
 * Environment variables:
 *   MOCK_PROVIDER_B_PORT — Port for the mock server (default: 4001)
 *
 * Endpoints:
 *   GET /provider/matches/:id/score
 *   GET /provider/matches/:id/commentary
 */
import dotenv from 'dotenv';
dotenv.config();

import { createServer } from 'node:http';
import { createProviderBMock } from '../src/modules/providers/provider-b/provider-b.service.js';

const port = parseInt(process.env.MOCK_PROVIDER_B_PORT ?? '4001', 10);
const { app } = createProviderBMock();
const server = createServer(app);

server.listen(port, () => {
  console.log(`Mock Provider B listening on port ${port}`);
  console.log(`  Score:      GET http://localhost:${port}/provider/matches/b-match-1001/score`);
  console.log(`  Commentary: GET http://localhost:${port}/provider/matches/b-match-1001/commentary`);
});

const shutdown = (): void => {
  server.close(() => {
    console.log('Mock Provider B stopped');
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
