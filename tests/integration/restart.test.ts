/**
 * TEST 9: Restart persistence.
 * Verifies that data persists across database close/reopen cycles.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createDatabase, seedDatabase, type DatabaseHandle } from '../../src/database/connection.js';
import { AggregationService } from '../../src/modules/aggregation/aggregation.service.js';

describe('Restart Persistence', () => {
  it('score, status, and commentary survive database close and reopen', () => {
    // Step 1: Create a temporary database file
    const tempDir = mkdtempSync(join(tmpdir(), 'aggregator-test-'));
    const dbPath = join(tempDir, 'test-restart.sqlite');

    try {
      // Step 2: Open database, seed, and ingest data
      let db: DatabaseHandle = createDatabase(dbPath);
      seedDatabase(db);

      const aggregation = new AggregationService(db);

      // Ingest score
      aggregation.ingestProviderAEvent(
        'match-1001',
        'd-restart-1',
        { sequence: 7, revision: 2, status: 'live', innings: 1, runs: 45, wickets: 2, overs: '7.3' },
        { ballId: 'inn1-7.3', sequence: 7, revision: 1, innings: 1, over: 7, ball: 3, text: 'Caught behind! Wicket falls.' },
        '2026-10-22T14:05:00.000Z',
      );

      // Ingest Provider B data too
      aggregation.ingestProviderBScore(
        'match-1001',
        { sequence: 10, revision: 1, status: 'live', innings: 1, runs: 55, wickets: 2, overs: '10.0' },
        null,
      );

      // Step 3: Close the database
      db.close();

      // Step 4: Reopen the same database file
      db = createDatabase(dbPath);

      // Step 5: Query and verify all data is still available
      const aggregation2 = new AggregationService(db);

      // Provider A snapshot
      const snapshotA = aggregation2.getSnapshot('provider-a', 'match-1001');
      expect(snapshotA).toBeDefined();
      expect(snapshotA!.sequence).toBe(7);
      expect(snapshotA!.revision).toBe(2);
      expect(snapshotA!.runs).toBe(45);
      expect(snapshotA!.wickets).toBe(2);
      expect(snapshotA!.status).toBe('live');
      expect(snapshotA!.overs).toBe('7.3');

      // Provider A commentary
      const commentaryA = aggregation2.getCommentary('provider-a', 'match-1001');
      expect(commentaryA).toHaveLength(1);
      expect(commentaryA[0]!.ballId).toBe('inn1-7.3');
      expect(commentaryA[0]!.text).toBe('Caught behind! Wicket falls.');

      // Provider B snapshot
      const snapshotB = aggregation2.getSnapshot('provider-b', 'match-1001');
      expect(snapshotB).toBeDefined();
      expect(snapshotB!.sequence).toBe(10);
      expect(snapshotB!.runs).toBe(55);

      // Delivery ID is remembered
      expect(aggregation2.isDeliveryProcessed('provider-a', 'd-restart-1')).toBe(true);
      expect(aggregation2.isDeliveryProcessed('provider-a', 'd-never-sent')).toBe(false);

      db.close();
    } finally {
      // Cleanup
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('seed data is idempotent across restarts', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'aggregator-test-'));
    const dbPath = join(tempDir, 'test-seed.sqlite');

    try {
      // First boot
      let db = createDatabase(dbPath);
      seedDatabase(db);
      db.close();

      // Second boot — seedDatabase should not throw or duplicate
      db = createDatabase(dbPath);
      seedDatabase(db);

      // Should still have exactly 1 match
      const count = db
        .prepare('SELECT COUNT(*) as cnt FROM matches')
        .get() as { cnt: number };
      expect(count.cnt).toBe(1);

      db.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
