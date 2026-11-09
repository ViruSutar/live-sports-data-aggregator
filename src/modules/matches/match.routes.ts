import { Router } from 'express';
import { MatchController } from './match.controller.js';
import type { MatchService } from './match.service.js';

/**
 * Creates the client-facing match routes.
 */
export function createMatchRoutes(matchService: MatchService): Router {
  const router = Router();
  const controller = new MatchController(matchService);

  router.get('/matches', controller.getAllMatches);
  router.get('/matches/:id', controller.getMatch);
  router.get('/matches/:id/score', controller.getScore);
  router.get('/matches/:id/commentary', controller.getCommentary);

  return router;
}
