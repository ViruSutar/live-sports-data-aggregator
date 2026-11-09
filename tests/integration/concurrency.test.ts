/**
 * TEST 10: Concurrent update safety.
 * Sends multiple updates for the same match concurrently and verifies
 * that the final result matches the tuple ordering rules.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createDatabase, seedDatabase, type DatabaseHandle } from '../../src/database/connection.js';
import { AggregationService } from '../../src/modules/aggregation/aggregation.service.js';
import type { Express } from 'express';

let db: DatabaseHandle;
let app: Express;

beforeEach(() => {
  db = createDatabase(':memory:');
  seedDatabase(db);
  app = createApp(db);
});

afterEach(() => {
  db.close();
});

describe('Concurrency', () => {
  it('concurrent Provider A webhooks maintain correct snapshot ordering', async () => {
    // Send 10 events concurrently with different sequences
    const promises = Array.from({ length: 10 }, (_, i) => {
      const seq = i + 1;
      return request(app)
        .post('/webhooks/provider-a')
        .send({
          provider: 'provider-a',
          deliveryId: `d-concurrent-${seq}`,
          occurredAt: '2026-10-22T14:00:00.000Z',
          providerMatchId: 'a-match-1001',
          snapshot: {
            sequence: seq,
            revision: 1,
            status: 'live',
            innings: 1,
            runs: seq * 5,
            wickets: 0,
            overs: `${seq}.0`,
          },
          commentary: {
            ballId: `ball-${seq}`,
            sequence: seq,
            revision: 1,
            innings: 1,
            over: seq,
            ball: 0,
            text: `Ball ${seq}`,
          },
        })
        .expect(200);
    });

    await Promise.all(promises);

    // The highest sequence (10) should be the stored snapshot
    const aggregation = new AggregationService(db);
    const snapshot = aggregation.getSnapshot('provider-a', 'match-1001');
    expect(snapshot).toBeDefined();
    expect(snapshot!.sequence).toBe(10);
    expect(snapshot!.runs).toBe(50);

    // All 10 commentary items should exist
    const commentary = aggregation.getCommentary('provider-a', 'match-1001');
    expect(commentary).toHaveLength(10);
  });

  it('concurrent snapshot corrections result in highest revision winning', async () => {
    // Send same sequence with different revisions concurrently
    const promises = Array.from({ length: 5 }, (_, i) => {
      const rev = i + 1;
      return request(app)
        .post('/webhooks/provider-a')
        .send({
          provider: 'provider-a',
          deliveryId: `d-rev-${rev}`,
          occurredAt: '2026-10-22T14:00:00.000Z',
          providerMatchId: 'a-match-1001',
          snapshot: {
            sequence: 4,
            revision: rev,
            status: 'live',
            innings: 1,
            runs: 20 + rev,
            wickets: 1,
            overs: '4.0',
          },
        })
        .expect(200);
    });

    await Promise.all(promises);

    // The highest revision (5) should win
    const aggregation = new AggregationService(db);
    const snapshot = aggregation.getSnapshot('provider-a', 'match-1001');
    expect(snapshot!.sequence).toBe(4);
    expect(snapshot!.revision).toBe(5);
    expect(snapshot!.runs).toBe(25);
  });

  it('concurrent Provider B ingestion respects sequence ordering', () => {
    const aggregation = new AggregationService(db);

    // Simulate concurrent-like interleaved writes
    // In a single-threaded Node.js + synchronous better-sqlite3, these are serialized
    // but the atomic UPSERT ensures correctness regardless
    aggregation.ingestProviderBScore(
      'match-1001',
      { sequence: 5, revision: 1, status: 'live', innings: 1, runs: 30, wickets: 0, overs: '5.0' },
      null,
    );
    aggregation.ingestProviderBScore(
      'match-1001',
      { sequence: 8, revision: 1, status: 'live', innings: 1, runs: 50, wickets: 1, overs: '8.0' },
      null,
    );
    aggregation.ingestProviderBScore(
      'match-1001',
      { sequence: 6, revision: 1, status: 'live', innings: 1, runs: 35, wickets: 0, overs: '6.0' },
      null,
    );

    const snapshot = aggregation.getSnapshot('provider-b', 'match-1001');
    expect(snapshot!.sequence).toBe(8);
    expect(snapshot!.runs).toBe(50);
  });
});
