import { providerBScoreSchema, providerBCommentarySchema } from '../../aggregation/aggregation.types.js';
import { AggregationService } from '../../aggregation/aggregation.service.js';
import { MatchRepository } from '../../matches/match.repository.js';
import type { DatabaseHandle } from '../../../database/connection.js';
import { logger } from '../../../common/utils/logger.js';

export interface PollerOptions {
  baseUrl: string;
  intervalMs: number;
  matchId?: string;
  fetchImpl?: typeof fetch;
}

export interface PollerHandle {
  start(): void;
  stop(): Promise<void>;
  pollOnce(): Promise<PollResult>;
}

export interface PollResult {
  kind: 'success' | 'partial' | 'failed' | 'skipped';
  scoreUpdated?: boolean;
  commentaryInserted?: number;
  commentaryUpdated?: number;
  errors?: string[];
}

/**
 * Provider B polling service.
 * Periodically polls score and commentary endpoints independently.
 *
 * Key design decisions:
 * - Score and commentary are polled independently. If one fails, the other still processes.
 * - Overlapping poll cycles are prevented with an inFlight guard.
 * - A failed poll never mutates stored state — last good state remains.
 * - Uses the same aggregation logic as Provider A (snapshot/commentary revision rules).
 * - Does NOT use asOf timestamps to determine snapshot precedence.
 */
export function createPoller(db: DatabaseHandle, options: PollerOptions): PollerHandle {
  const aggregation = new AggregationService(db);
  const matchRepo = new MatchRepository(db);
  const fetchFn = options.fetchImpl ?? fetch;
  const providerMatchId = options.matchId ?? 'b-match-1001';

  let timer: ReturnType<typeof setInterval> | undefined;
  let inFlight = false;

  async function pollScore(matchId: string): Promise<{ updated: boolean } | { error: string }> {
    try {
      const url = `${options.baseUrl}/provider/matches/${providerMatchId}/score`;
      const response = await fetchFn(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        throw new Error(`Provider B score returned HTTP ${response.status}`);
      }

      const data = await response.json();
      const parsed = providerBScoreSchema.parse(data);

      // Resolve provider match ID to internal match ID
      const result = aggregation.ingestProviderBScore(
        matchId,
        {
          sequence: parsed.snapshot.sequence,
          revision: parsed.snapshot.revision,
          status: parsed.snapshot.status,
          innings: parsed.snapshot.innings,
          runs: parsed.snapshot.runs,
          wickets: parsed.snapshot.wickets,
          overs: parsed.snapshot.overs,
        },
        parsed.snapshot.asOf,
      );

      return { updated: result.snapshotUpdated };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, 'Provider B score poll failed');
      return { error: message };
    }
  }

  async function pollCommentary(matchId: string): Promise<{
    inserted: number;
    updated: number;
  } | { error: string }> {
    try {
      const url = `${options.baseUrl}/provider/matches/${providerMatchId}/commentary`;
      const response = await fetchFn(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        throw new Error(`Provider B commentary returned HTTP ${response.status}`);
      }

      const data = await response.json();
      const parsed = providerBCommentarySchema.parse(data);

      const items = parsed.items.map((item) => ({
        ballId: item.ballId,
        sequence: item.sequence,
        revision: item.revision,
        innings: item.innings,
        over: item.over,
        ball: item.ball,
        text: item.text,
        occurredAt: item.occurredAt,
      }));

      const result = aggregation.ingestProviderBCommentary(matchId, items);

      return { inserted: result.commentaryInserted, updated: result.commentaryUpdated };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, 'Provider B commentary poll failed');
      return { error: message };
    }
  }

  async function pollOnce(): Promise<PollResult> {
    if (inFlight) {
      logger.warn('Skipping Provider B poll — previous poll still in progress');
      return { kind: 'skipped' };
    }

    inFlight = true;

    try {
      // Resolve match ID
      const matchId = matchRepo.resolveMatchId('provider-b', providerMatchId);
      if (!matchId) {
        logger.error({ providerMatchId }, 'Cannot resolve Provider B match ID');
        return { kind: 'failed', errors: ['Unknown provider match ID'] };
      }

      // Poll score and commentary independently
      const [scoreResult, commentaryResult] = await Promise.all([
        pollScore(matchId),
        pollCommentary(matchId),
      ]);

      const errors: string[] = [];
      let scoreUpdated = false;
      let commentaryInserted = 0;
      let commentaryUpdated = 0;

      if ('error' in scoreResult) {
        errors.push(`Score: ${scoreResult.error}`);
      } else {
        scoreUpdated = scoreResult.updated;
      }

      if ('error' in commentaryResult) {
        errors.push(`Commentary: ${commentaryResult.error}`);
      } else {
        commentaryInserted = commentaryResult.inserted;
        commentaryUpdated = commentaryResult.updated;
      }

      if (errors.length === 2) {
        return { kind: 'failed', errors };
      }

      const kind = errors.length === 0 ? 'success' : 'partial';
      logger.info(
        { kind, scoreUpdated, commentaryInserted, commentaryUpdated },
        'Provider B poll completed',
      );

      return { kind, scoreUpdated, commentaryInserted, commentaryUpdated, errors: errors.length > 0 ? errors : undefined };
    } finally {
      inFlight = false;
    }
  }

  return {
    start(): void {
      if (timer !== undefined) return;
      logger.info(
        { intervalMs: options.intervalMs, baseUrl: options.baseUrl },
        'Starting Provider B poller',
      );
      // Immediate first poll
      void pollOnce();
      timer = setInterval(() => {
        void pollOnce();
      }, options.intervalMs);
    },

    stop(): Promise<void> {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
        logger.info('Provider B poller stopped');
      }
      return Promise.resolve();
    },

    pollOnce,
  };
}
