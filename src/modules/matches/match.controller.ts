import type { Request, Response, NextFunction } from 'express';
import type { MatchService } from './match.service.js';
import { AppError } from '../../common/errors/app-error.js';

/**
 * Match controller — handles HTTP concerns only.
 * Delegates all business logic to MatchService.
 */
export class MatchController {
  constructor(private readonly matchService: MatchService) {}

  /** GET /matches */
  getAllMatches = (_req: Request, res: Response, next: NextFunction): void => {
    try {
      const matches = this.matchService.getAllMatches();
      res.status(200).json({ data: matches });
    } catch (err) {
      next(err);
    }
  };

  /** GET /matches/:id */
  getMatch = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const matchId = this.extractParamId(req);
      const match = this.matchService.getMatch(matchId);
      res.status(200).json({ data: match });
    } catch (err) {
      next(err);
    }
  };

  /** GET /matches/:id/score */
  getScore = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const matchId = this.extractParamId(req);
      const score = this.matchService.getScore(matchId);
      res.status(200).json({ data: score });
    } catch (err) {
      next(err);
    }
  };

  /** GET /matches/:id/commentary */
  getCommentary = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const matchId = this.extractParamId(req);
      const commentary = this.matchService.getCommentary(matchId);
      res.status(200).json({ data: commentary });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Extracts and validates :id path parameter.
   * Express 5 params can be string | string[] — we enforce a single string.
   */
  private extractParamId(req: Request): string {
    const raw = req.params.id;
    const matchId = Array.isArray(raw) ? raw[0] : raw;
    if (!matchId || typeof matchId !== 'string') {
      throw AppError.badRequest('Match ID is required');
    }
    return matchId;
  }
}
