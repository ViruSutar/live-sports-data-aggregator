/**
 * Script to run the Provider A deterministic event generator.
 *
 * Usage:
 *   npx tsx scripts/run-provider-a.ts
 *
 * Environment variables:
 *   PROVIDER_A_WEBHOOK_URL — Target webhook URL (default: http://localhost:3000/webhooks/provider-a)
 */
import dotenv from 'dotenv';
dotenv.config();

import { runProviderAGenerator } from '../src/modules/providers/provider-a/provider-a.generator.js';

const webhookUrl =
  process.env.PROVIDER_A_WEBHOOK_URL ?? 'http://localhost:3000/webhooks/provider-a';

runProviderAGenerator(webhookUrl).catch((error: unknown) => {
  console.error('Provider A generator failed:', error);
  process.exitCode = 1;
});
