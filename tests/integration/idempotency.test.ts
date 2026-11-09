/**
 * TEST 2 (extended): Idempotency tests.
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

describe('Idempotency', () => {
  it('duplicate deliveryId does not reapply snapshot or commentary', async () => {
    const payload = {
      provider: 'provider-a',
      deliveryId: 'd-idem-1',
      occurredAt: '2026-10-22T14:00:00.000Z',
      providerMatchId: 'a-match-1001',
      snapshot: { sequence: 5, revision: 1, status: 'live', innings: 1, runs: 30, wickets: 1, overs: '5.0' },
      commentary: { ballId: 'b1', sequence: 5, revision: 1, innings: 1, over: 5, ball: 0, text: 'Original.' },
    };

    // First
    await request(app).post('/webhooks/provider-a').send(payload).expect(200);

    // Duplicate
    const res = await request(app).post('/webhooks/provider-a').send(payload).expect(200);
    expect(res.body.duplicate).toBe(true);

    // Only one commentary item exists
    const aggregation = new AggregationService(db);
    const items = aggregation.getCommentary('provider-a', 'match-1001');
    expect(items).toHaveLength(1);
  });

  it('Provider B polling with identical data is naturally idempotent', async () => {
    const aggregation = new AggregationService(db);

    // Ingest same data twice
    aggregation.ingestProviderBScore(
      'match-1001',
      { sequence: 3, revision: 1, status: 'live', innings: 1, runs: 20, wickets: 0, overs: '3.0' },
      null,
    );
    aggregation.ingestProviderBScore(
      'match-1001',
      { sequence: 3, revision: 1, status: 'live', innings: 1, runs: 20, wickets: 0, overs: '3.0' },
      null,
    );

    aggregation.ingestProviderBCommentary('match-1001', [
      { ballId: 'b1', sequence: 1, revision: 1, innings: 1, over: 0, ball: 1, text: 'Ball one.' },
    ]);
    aggregation.ingestProviderBCommentary('match-1001', [
      { ballId: 'b1', sequence: 1, revision: 1, innings: 1, over: 0, ball: 1, text: 'Ball one.' },
    ]);

    // Only one commentary item
    const items = aggregation.getCommentary('provider-b', 'match-1001');
    expect(items).toHaveLength(1);
  });
});
