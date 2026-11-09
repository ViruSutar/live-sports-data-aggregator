import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { providerAEventSchema } from '../../aggregation/aggregation.types.js';
import { AggregationService } from '../../aggregation/aggregation.service.js';
import { MatchRepository } from '../../matches/match.repository.js';
import { AppError } from '../../../common/errors/app-error.js';
import { logger } from '../../../common/utils/logger.js';

/**
 * Provider A webhook controller.
 * Handles HTTP concerns, validates payloads, and delegates to AggregationService.
 *
 * Returns HTTP 200 only after the database transaction commits.
 * Duplicate deliveries are acknowledged without reprocessing.
 */
export class ProviderAController {
  constructor(
    private readonly aggregation: AggregationService,
    private readonly matchRepo: MatchRepository,
  ) {}

  /** POST /webhooks/provider-a */
  handleWebhook = (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Step 1: Validate the payload with Zod
      const parsed = providerAEventSchema.parse(req.body);

      // Step 2: Quick duplicate check before full processing
      // (The transaction will also check, but this avoids unnecessary validation work)
      if (this.aggregation.isDeliveryProcessed('provider-a', parsed.deliveryId)) {
        logger.info(
          { deliveryId: parsed.deliveryId },
          'Duplicate Provider A delivery acknowledged',
        );
        res.status(200).json({
          success: true,
          duplicate: true,
        });
        return;
      }

      // Step 3: Resolve provider match ID to internal match ID
      const matchId = this.matchRepo.resolveMatchId('provider-a', parsed.providerMatchId);
      if (!matchId) {
        throw AppError.badRequest(
          `Unknown provider match ID: ${parsed.providerMatchId}`,
        );
      }

      // Step 4: Ingest atomically — delivery ID + snapshot + commentary in one transaction
      const result = this.aggregation.ingestProviderAEvent(
        matchId,
        parsed.deliveryId,
        parsed.snapshot,
        parsed.commentary,
        parsed.occurredAt,
      );

      // Step 5: Respond AFTER transaction commits
      logger.info(
        {
          deliveryId: parsed.deliveryId,
          matchId,
          duplicate: result.duplicate,
          snapshotUpdated: result.snapshotUpdated,
          commentaryInserted: result.commentaryInserted,
          commentaryUpdated: result.commentaryUpdated,
        },
        'Provider A webhook processed',
      );

      res.status(200).json({
        success: true,
        duplicate: result.duplicate,
      });
    } catch (err) {
      if (err instanceof ZodError) {
        logger.warn({ errors: err.errors }, 'Provider A payload validation failed');
        res.status(400).json({
          error: 'Validation failed',
          details: err.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        });
        return;
      }
      next(err);
    }
  };
}
