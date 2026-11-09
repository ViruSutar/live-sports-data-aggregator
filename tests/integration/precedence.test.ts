/**
 * TEST 11: Provider precedence.
 * Verifies that the configured primary provider's data is returned
 * and that providers are never compared by sequence number.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createDatabase, seedDatabase, type DatabaseHandle } from '../../src/database/connection.js';
import { AggregationService } from '../../src/modules/aggregation/aggregation.service.js';
import type { Express } from 'express';

let db: DatabaseHandle;

beforeEach(() => {
  db = createDatabase(':memory:');
  seedDatabase(db);
});

afterEach(() => {
  db.close();
});

describe('Provider Precedence', () => {
  it('returns Provider A data when it is the primary and both have snapshots', async () => {
    const aggregation = new AggregationService(db);

    // Provider A: sequence 3, runs 20
    aggregation.ingestProviderAEvent(
      'match-1001',
      'd-prec-1',
      { sequence: 3, revision: 1, status: 'live', innings: 1, runs: 20, wickets: 0, overs: '3.0' },
      undefined,
      null,
    );

    // Provider B: sequence 90, runs 200 (much "newer" by sequence — but cross-provider comparison is forbidden)
    aggregation.ingestProviderBScore(
      'match-1001',
      { sequence: 90, revision: 1, status: 'live', innings: 1, runs: 200, wickets: 5, overs: '30.0' },
      null,
    );

    // App configured with provider-a as primary (default)
    const app = createApp(db, { primaryProvider: 'provider-a' });
    const res = await request(app).get('/matches/match-1001/score').expect(200);

    expect(res.body.data.provider).toBe('provider-a');
    expect(res.body.data.runs).toBe(20);
    expect(res.body.data.sequence).toBeUndefined(); // Score response shouldn't leak internal versioning
  });

  it('returns Provider B data when configured as primary', async () => {
    const aggregation = new AggregationService(db);

    aggregation.ingestProviderAEvent(
      'match-1001',
      'd-prec-2',
      { sequence: 100, revision: 1, status: 'live', innings: 1, runs: 300, wickets: 9, overs: '49.5' },
      undefined,
      null,
    );

    aggregation.ingestProviderBScore(
      'match-1001',
      { sequence: 2, revision: 1, status: 'live', innings: 1, runs: 10, wickets: 0, overs: '2.0' },
      null,
    );

    // App configured with provider-b as primary
    const app = createApp(db, { primaryProvider: 'provider-b' });
    const res = await request(app).get('/matches/match-1001/score').expect(200);

    expect(res.body.data.provider).toBe('provider-b');
    expect(res.body.data.runs).toBe(10);
  });

  it('falls back to secondary provider when primary has no snapshot', async () => {
    const aggregation = new AggregationService(db);

    // Only Provider B has data
    aggregation.ingestProviderBScore(
      'match-1001',
      { sequence: 5, revision: 1, status: 'live', innings: 1, runs: 40, wickets: 1, overs: '5.0' },
      null,
    );

    // Provider A is primary but has no data
    const app: Express = createApp(db, { primaryProvider: 'provider-a' });
    const res = await request(app).get('/matches/match-1001/score').expect(200);

    expect(res.body.data.provider).toBe('provider-b');
    expect(res.body.data.runs).toBe(40);
  });

  it('does not mix commentary from different providers', async () => {
    const aggregation = new AggregationService(db);

    // Provider A has commentary
    aggregation.ingestProviderAEvent(
      'match-1001',
      'd-prec-comm-1',
      { sequence: 1, revision: 1, status: 'live', innings: 1, runs: 5, wickets: 0, overs: '0.3' },
      { ballId: 'a-ball', sequence: 1, revision: 1, innings: 1, over: 0, ball: 3, text: 'Provider A ball.' },
      null,
    );

    // Provider B has different commentary
    aggregation.ingestProviderBCommentary('match-1001', [
      { ballId: 'b-ball', sequence: 1, revision: 1, innings: 1, over: 0, ball: 1, text: 'Provider B ball.' },
    ]);

    const app: Express = createApp(db, { primaryProvider: 'provider-a' });
    const res = await request(app).get('/matches/match-1001/commentary').expect(200);

    // Should only have Provider A's commentary
    expect(res.body.data.provider).toBe('provider-a');
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].text).toBe('Provider A ball.');
  });

  it('falls back to secondary provider commentary when primary has none', async () => {
    const aggregation = new AggregationService(db);

    // Provider A has snapshot but no commentary
    aggregation.ingestProviderAEvent(
      'match-1001',
      'd-prec-comm-2',
      { sequence: 1, revision: 1, status: 'live', innings: 1, runs: 5, wickets: 0, overs: '0.3' },
      undefined,
      null,
    );

    // Provider B has commentary
    aggregation.ingestProviderBCommentary('match-1001', [
      { ballId: 'b-only', sequence: 1, revision: 1, innings: 1, over: 0, ball: 1, text: 'Fallback commentary.' },
    ]);

    const app: Express = createApp(db, { primaryProvider: 'provider-a' });
    const res = await request(app).get('/matches/match-1001/commentary').expect(200);

    // Should fall back to Provider B
    expect(res.body.data.provider).toBe('provider-b');
    expect(res.body.data.items).toHaveLength(1);
  });
});
