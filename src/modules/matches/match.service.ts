import type { DatabaseHandle } from '../../database/connection.js';
import type {
  Provider,
  MatchSummary,
  MatchDetail,
  ScoreResponse,
  CommentaryResponse,
  StoredSnapshot,
} from '../../common/types/index.js';
import { MatchRepository } from './match.repository.js';
import { AggregationService } from '../aggregation/aggregation.service.js';
import { AppError } from '../../common/errors/app-error.js';

/**
 * Match service — implements provider precedence and client-facing data assembly.
 *
 * Provider precedence rules:
 * 1. If the configured primary provider has a snapshot, return it.
 * 2. Otherwise, use the secondary provider's snapshot if available.
 * 3. If the primary provider temporarily fails, continue returning its last stored snapshot.
 * 4. Apply the same provider-selection rule to commentary.
 * 5. Do not mix commentary from different providers in one response.
 * 6. Do not automatically fail over just because a poll failed.
 */
export class MatchService {
  private readonly matchRepo: MatchRepository;
  private readonly aggregation: AggregationService;
  private readonly providerOrder: readonly [Provider, Provider];

  constructor(db: DatabaseHandle, primaryProvider: Provider = 'provider-a') {
    this.matchRepo = new MatchRepository(db);
    this.aggregation = new AggregationService(db);
    this.providerOrder =
      primaryProvider === 'provider-a'
        ? ['provider-a', 'provider-b']
        : ['provider-b', 'provider-a'];
  }

  /** GET /matches — Returns all known matches with score from the preferred provider */
  getAllMatches(): MatchSummary[] {
    const matches = this.matchRepo.findAll();

    return matches.map((match) => {
      const snapshot = this.selectSnapshot(match.id);
      return {
        id: match.id,
        name: match.name,
        status: snapshot?.status ?? null,
        score: snapshot
          ? {
              innings: snapshot.innings,
              runs: snapshot.runs,
              wickets: snapshot.wickets,
              overs: snapshot.overs,
            }
          : null,
      };
    });
  }

  /** GET /matches/:id — Returns complete match information */
  getMatch(matchId: string): MatchDetail {
    const match = this.matchRepo.findById(matchId);
    if (!match) {
      throw AppError.notFound(`Match '${matchId}' not found`);
    }

    const snapshot = this.selectSnapshot(matchId);
    return {
      id: match.id,
      name: match.name,
      status: snapshot?.status ?? null,
      provider: snapshot?.provider ?? null,
      score: snapshot
        ? {
            innings: snapshot.innings,
            runs: snapshot.runs,
            wickets: snapshot.wickets,
            overs: snapshot.overs,
          }
        : null,
    };
  }

  /** GET /matches/:id/score — Returns score from the preferred provider */
  getScore(matchId: string): ScoreResponse {
    const match = this.matchRepo.findById(matchId);
    if (!match) {
      throw AppError.notFound(`Match '${matchId}' not found`);
    }

    const snapshot = this.selectSnapshot(matchId);
    if (!snapshot) {
      throw AppError.notFound(`No score available for match '${matchId}'`);
    }

    return {
      matchId: match.id,
      provider: snapshot.provider,
      status: snapshot.status,
      innings: snapshot.innings,
      runs: snapshot.runs,
      wickets: snapshot.wickets,
      overs: snapshot.overs,
    };
  }

  /** GET /matches/:id/commentary — Returns commentary from the preferred provider */
  getCommentary(matchId: string): { matchId: string; provider: Provider | null; items: CommentaryResponse[] } {
    const match = this.matchRepo.findById(matchId);
    if (!match) {
      throw AppError.notFound(`Match '${matchId}' not found`);
    }

    // Select commentary from the primary provider if they have any,
    // otherwise fall back to secondary. Never mix providers.
    const provider = this.selectCommentaryProvider(matchId);

    if (!provider) {
      return { matchId: match.id, provider: null, items: [] };
    }

    const commentary = this.aggregation.getCommentary(provider, matchId);

    return {
      matchId: match.id,
      provider,
      items: commentary.map((c) => ({
        ballId: c.ballId,
        sequence: c.sequence,
        revision: c.revision,
        innings: c.innings,
        over: c.over,
        ball: c.ball,
        text: c.text,
      })),
    };
  }

  /**
   * Selects the snapshot to return based on provider precedence.
   * Returns the primary provider's snapshot if it exists, otherwise falls back to secondary.
   */
  private selectSnapshot(matchId: string): StoredSnapshot | undefined {
    for (const provider of this.providerOrder) {
      const snapshot = this.aggregation.getSnapshot(provider, matchId);
      if (snapshot) return snapshot;
    }
    return undefined;
  }

  /**
   * Selects which provider's commentary to return.
   * Returns the primary provider if they have commentary, otherwise falls back.
   */
  private selectCommentaryProvider(matchId: string): Provider | null {
    for (const provider of this.providerOrder) {
      const commentary = this.aggregation.getCommentary(provider, matchId);
      if (commentary.length > 0) return provider;
    }
    return null;
  }
}
