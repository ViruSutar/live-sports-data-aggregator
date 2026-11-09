import type { DatabaseHandle } from '../../database/connection.js';
import type {
  Provider,
  IngestResult,
  StoredSnapshot,
  StoredCommentary,
} from '../../common/types/index.js';
import type { ValidatedSnapshot, ValidatedCommentaryItem } from './aggregation.types.js';
import { logger } from '../../common/utils/logger.js';

interface SnapshotRow {
  id: number;
  provider: string;
  match_id: string;
  sequence: number;
  revision: number;
  status: string;
  innings: number;
  runs: number;
  wickets: number;
  overs: string;
  provider_timestamp: string | null;
  updated_at: string;
}

interface CommentaryRow {
  id: number;
  provider: string;
  match_id: string;
  ball_id: string;
  sequence: number;
  revision: number;
  innings: number;
  over: number;
  ball: number;
  text: string;
  occurred_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Core aggregation service.
 * Handles atomic ingestion of snapshots and commentary from both providers.
 * Both Provider A (push) and Provider B (poll) converge through this service.
 *
 * CRITICAL CONCURRENCY DESIGN:
 * Uses atomic SQLite UPSERT with conditional WHERE clauses to prevent race conditions.
 * Never uses read-then-write patterns for snapshot or commentary updates.
 */
export class AggregationService {
  constructor(private readonly db: DatabaseHandle) {}

  /**
   * Ingest a Provider A webhook event atomically.
   *
   * In one database transaction:
   * 1. Register the delivery ID (idempotency).
   * 2. Apply the snapshot if newer (atomic UPSERT).
   * 3. Apply commentary if new or corrected (atomic UPSERT).
   *
   * If the delivery ID already exists, return duplicate without processing.
   * If any step fails, the entire transaction rolls back.
   */
  ingestProviderAEvent(
    matchId: string,
    deliveryId: string,
    snapshot: ValidatedSnapshot | undefined,
    commentary: ValidatedCommentaryItem | undefined,
    providerTimestamp: string | null,
  ): IngestResult {
    const provider: Provider = 'provider-a';

    const transaction = this.db.transaction((): IngestResult => {
      // Step 1: Delivery-level idempotency
      const deliveryInsert = this.db
        .prepare(
          `INSERT OR IGNORE INTO processed_deliveries (provider, delivery_id)
           VALUES (?, ?)`,
        )
        .run(provider, deliveryId);

      if (deliveryInsert.changes === 0) {
        // Duplicate delivery — do not process any contents
        return {
          duplicate: true,
          snapshotUpdated: false,
          commentaryInserted: 0,
          commentaryUpdated: 0,
        };
      }

      // Step 2: Apply snapshot if present and newer
      const snapshotUpdated = snapshot
        ? this.upsertSnapshot(provider, matchId, snapshot, providerTimestamp)
        : false;

      // Step 3: Apply commentary if present
      let commentaryInserted = 0;
      let commentaryUpdated = 0;
      if (commentary) {
        const result = this.upsertCommentary(provider, matchId, commentary, providerTimestamp);
        commentaryInserted = result.inserted;
        commentaryUpdated = result.updated;
      }

      return {
        duplicate: false,
        snapshotUpdated,
        commentaryInserted,
        commentaryUpdated,
      };
    });

    // Use IMMEDIATE transaction to prevent read-then-write race conditions.
    // This acquires the write lock at the start, not when the first write happens.
    return transaction.immediate();
  }

  /**
   * Ingest Provider B poll data.
   * No delivery ID tracking — polling is inherently idempotent through
   * the snapshot/commentary revision rules.
   */
  ingestProviderBScore(
    matchId: string,
    snapshot: ValidatedSnapshot,
    providerTimestamp: string | null,
  ): { snapshotUpdated: boolean } {
    const provider: Provider = 'provider-b';

    const transaction = this.db.transaction(() => {
      const snapshotUpdated = this.upsertSnapshot(provider, matchId, snapshot, providerTimestamp);
      return { snapshotUpdated };
    });

    return transaction.immediate();
  }

  ingestProviderBCommentary(
    matchId: string,
    items: Array<ValidatedCommentaryItem & { occurredAt?: string }>,
  ): { commentaryInserted: number; commentaryUpdated: number } {
    const provider: Provider = 'provider-b';

    const transaction = this.db.transaction(() => {
      let commentaryInserted = 0;
      let commentaryUpdated = 0;

      for (const item of items) {
        const result = this.upsertCommentary(provider, matchId, item, item.occurredAt ?? null);
        commentaryInserted += result.inserted;
        commentaryUpdated += result.updated;
      }

      return { commentaryInserted, commentaryUpdated };
    });

    return transaction.immediate();
  }

  /**
   * Atomic snapshot UPSERT with conditional WHERE clause.
   *
   * CRITICAL: This uses a database-level conditional update, NOT a
   * read-then-compare-then-write pattern. The WHERE clause ensures that
   * only a strictly newer (sequence, revision) tuple can overwrite the stored one.
   *
   * SQL logic:
   *   INSERT ... ON CONFLICT DO UPDATE
   *   WHERE excluded.sequence > stored.sequence
   *      OR (excluded.sequence = stored.sequence AND excluded.revision > stored.revision)
   *
   * This is safe under concurrent access because SQLite serializes writers.
   */
  private upsertSnapshot(
    provider: Provider,
    matchId: string,
    snapshot: ValidatedSnapshot,
    providerTimestamp: string | null,
  ): boolean {
    const result = this.db
      .prepare(
        `INSERT INTO provider_score_snapshots
           (provider, match_id, sequence, revision, status, innings, runs, wickets, overs, provider_timestamp, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(provider, match_id)
         DO UPDATE SET
           sequence = excluded.sequence,
           revision = excluded.revision,
           status = excluded.status,
           innings = excluded.innings,
           runs = excluded.runs,
           wickets = excluded.wickets,
           overs = excluded.overs,
           provider_timestamp = excluded.provider_timestamp,
           updated_at = datetime('now')
         WHERE
           excluded.sequence > provider_score_snapshots.sequence
           OR (
             excluded.sequence = provider_score_snapshots.sequence
             AND excluded.revision > provider_score_snapshots.revision
           )`,
      )
      .run(
        provider,
        matchId,
        snapshot.sequence,
        snapshot.revision,
        snapshot.status,
        snapshot.innings,
        snapshot.runs,
        snapshot.wickets,
        snapshot.overs,
        providerTimestamp,
      );

    const updated = result.changes > 0;
    if (updated) {
      logger.info(
        { provider, matchId, sequence: snapshot.sequence, revision: snapshot.revision },
        'Snapshot updated',
      );
    } else {
      logger.debug(
        { provider, matchId, sequence: snapshot.sequence, revision: snapshot.revision },
        'Snapshot rejected (not newer)',
      );
    }
    return updated;
  }

  /**
   * Atomic commentary UPSERT with conditional WHERE clause.
   *
   * Identity: (provider, match_id, ball_id)
   * A new ballId creates a record. A higher revision updates the existing record.
   * An equal or lower revision does not overwrite.
   *
   * The UPSERT WHERE clause ensures atomic revision comparison at the database level.
   */
  private upsertCommentary(
    provider: Provider,
    matchId: string,
    item: ValidatedCommentaryItem,
    occurredAt: string | null,
  ): { inserted: number; updated: number } {
    // Callers execute this method inside an IMMEDIATE transaction, so this
    // existence check and the following UPSERT cannot race with another writer.
    const existed = this.db
      .prepare(
        `SELECT 1 FROM provider_commentary
         WHERE provider = ? AND match_id = ? AND ball_id = ?`,
      )
      .get(provider, matchId, item.ballId) !== undefined;

    const result = this.db
      .prepare(
        `INSERT INTO provider_commentary
           (provider, match_id, ball_id, sequence, revision, innings, over, ball, text, occurred_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(provider, match_id, ball_id)
         DO UPDATE SET
           sequence = excluded.sequence,
           revision = excluded.revision,
           innings = excluded.innings,
           over = excluded.over,
           ball = excluded.ball,
           text = excluded.text,
           occurred_at = excluded.occurred_at,
           updated_at = datetime('now')
         WHERE excluded.revision > provider_commentary.revision`,
      )
      .run(
        provider,
        matchId,
        item.ballId,
        item.sequence,
        item.revision,
        item.innings,
        item.over,
        item.ball,
        item.text,
        occurredAt,
      );

    if (result.changes === 0) {
      return { inserted: 0, updated: 0 };
    }

    return existed ? { inserted: 0, updated: 1 } : { inserted: 1, updated: 0 };
  }

  /** Get the stored snapshot for a specific provider and match */
  getSnapshot(provider: Provider, matchId: string): StoredSnapshot | undefined {
    const row = this.db
      .prepare(
        `SELECT id, provider, match_id, sequence, revision, status, innings, runs, wickets, overs, provider_timestamp, updated_at
         FROM provider_score_snapshots
         WHERE provider = ? AND match_id = ?`,
      )
      .get(provider, matchId) as SnapshotRow | undefined;

    return row ? this.mapSnapshotRow(row) : undefined;
  }

  /** Get commentary for a specific provider and match, ordered by sequence ascending */
  getCommentary(provider: Provider, matchId: string): StoredCommentary[] {
    const rows = this.db
      .prepare(
        `SELECT id, provider, match_id, ball_id, sequence, revision, innings, over, ball, text, occurred_at, created_at, updated_at
         FROM provider_commentary
         WHERE provider = ? AND match_id = ?
         ORDER BY sequence ASC, ball_id ASC`,
      )
      .all(provider, matchId) as CommentaryRow[];

    return rows.map(this.mapCommentaryRow);
  }

  /** Check if a delivery has already been processed */
  isDeliveryProcessed(provider: Provider, deliveryId: string): boolean {
    const row = this.db
      .prepare(
        'SELECT 1 FROM processed_deliveries WHERE provider = ? AND delivery_id = ?',
      )
      .get(provider, deliveryId);

    return row !== undefined;
  }

  private mapSnapshotRow(row: SnapshotRow): StoredSnapshot {
    return {
      id: row.id,
      provider: row.provider as Provider,
      matchId: row.match_id,
      sequence: row.sequence,
      revision: row.revision,
      status: row.status,
      innings: row.innings,
      runs: row.runs,
      wickets: row.wickets,
      overs: row.overs,
      providerTimestamp: row.provider_timestamp,
      updatedAt: row.updated_at,
    };
  }

  private mapCommentaryRow(row: CommentaryRow): StoredCommentary {
    return {
      id: row.id,
      provider: row.provider as Provider,
      matchId: row.match_id,
      ballId: row.ball_id,
      sequence: row.sequence,
      revision: row.revision,
      innings: row.innings,
      over: row.over,
      ball: row.ball,
      text: row.text,
      occurredAt: row.occurred_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
