import { Router } from 'express';
import { ProviderAController } from './provider-a.controller.js';
import { AggregationService } from '../../aggregation/aggregation.service.js';
import { MatchRepository } from '../../matches/match.repository.js';
import type { DatabaseHandle } from '../../../database/connection.js';

/**
 * Creates Provider A webhook routes.
 */
export function createProviderARoutes(db: DatabaseHandle): Router {
  const router = Router();
  const aggregation = new AggregationService(db);
  const matchRepo = new MatchRepository(db);
  const controller = new ProviderAController(aggregation, matchRepo);

  router.post('/webhooks/provider-a', controller.handleWebhook);

  return router;
}
