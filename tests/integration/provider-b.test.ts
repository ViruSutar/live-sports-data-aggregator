/**
 * Integration tests for Provider B polling.
 * Tests: repeated polls, stale polls, provider error handling.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createDatabase, seedDatabase, type DatabaseHandle } from '../../src/database/connection.js';
import { AggregationService } from '../../src/modules/aggregation/aggregation.service.js';
import { createPoller } from '../../src/modules/providers/provider-b/provider-b.poller.js';
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

function makeScoreResponse(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'provider-b',
    providerMatchId: 'b-match-1001',
    snapshot: {
      sequence: 1,
      revision: 1,
      status: 'live',
      innings: 1,
      runs: 10,
      wickets: 0,
      overs: '1.4',
      asOf: '2026-10-22T14:00:00.000Z',
      ...overrides,
    },
  };
}

function makeCommentaryResponse(items: Array<Record<string, unknown>> = []) {
  return {
    provider: 'provider-b',
    providerMatchId: 'b-match-1001',
    items: items.map((item) => ({
      ballId: 'ball-1',
      sequence: 1,
      revision: 1,
      innings: 1,
      over: 0,
      ball: 1,
      text: 'Default ball text.',
      occurredAt: '2026-10-22T14:00:00.000Z',
      ...item,
    })),
  };
}

/**
 * Creates a fake fetch that returns different responses for score and commentary URLs.
 */
function createMockFetch(
  scoreResponse: { status: number; body: unknown },
  commentaryResponse: { status: number; body: unknown },
): typeof fetch {
  return async (input: string | URL | globalThis.Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (url.includes('/score')) {
      return new Response(JSON.stringify(scoreResponse.body), {
        status: scoreResponse.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/commentary')) {
      return new Response(JSON.stringify(commentaryResponse.body), {
        status: commentaryResponse.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  };
}

describe('Provider B Integration', () => {
  // TEST 6: Repeated identical polls
  it('does not create duplicate commentary on repeated identical polls', async () => {
    const commentary = [
      { ballId: 'b1', sequence: 1, revision: 1, innings: 1, over: 0, ball: 1, text: 'Ball one.', occurredAt: '2026-10-22T14:00:01.000Z' },
      { ballId: 'b2', sequence: 2, revision: 1, innings: 1, over: 0, ball: 2, text: 'Ball two.', occurredAt: '2026-10-22T14:00:30.000Z' },
    ];

    const mockFetch = createMockFetch(
      { status: 200, body: makeScoreResponse() },
      { status: 200, body: makeCommentaryResponse(commentary) },
    );

    const poller = createPoller(db, {
      baseUrl: 'http://mock-provider-b',
      intervalMs: 60000,
      fetchImpl: mockFetch,
    });

    // Poll 3 times with identical data
    await poller.pollOnce();
    await poller.pollOnce();
    await poller.pollOnce();

    // Should still have exactly 2 commentary items
    const commRes = await request(app).get('/matches/match-1001/commentary').expect(200);
    // Check via provider-b since that's secondary and we need to check directly
    const aggregation = new AggregationService(db);
    const items = aggregation.getCommentary('provider-b', 'match-1001');
    expect(items).toHaveLength(2);
  });

  // TEST 7: Stale poll
  it('preserves newer snapshot when a stale poll arrives with a recent timestamp', async () => {
    // First, ingest a newer snapshot via Provider B directly
    const aggregation = new AggregationService(db);
    aggregation.ingestProviderBScore(
      'match-1001',
      { sequence: 10, revision: 1, status: 'live', innings: 1, runs: 100, wickets: 1, overs: '10.0' },
      '2026-10-22T14:05:00.000Z',
    );

    // Now poll returns an OLDER snapshot with a RECENT asOf timestamp
    const mockFetch = createMockFetch(
      {
        status: 200,
        body: makeScoreResponse({
          sequence: 5, // STALE — less than stored 10
          revision: 1,
          runs: 50,
          asOf: '2026-10-22T14:06:00.000Z', // Recent timestamp — should NOT matter
        }),
      },
      { status: 200, body: makeCommentaryResponse([]) },
    );

    const poller = createPoller(db, {
      baseUrl: 'http://mock-provider-b',
      intervalMs: 60000,
      fetchImpl: mockFetch,
    });

    await poller.pollOnce();

    // Verify the newer stored snapshot is preserved
    const snapshot = aggregation.getSnapshot('provider-b', 'match-1001');
    expect(snapshot?.sequence).toBe(10);
    expect(snapshot?.runs).toBe(100);
  });

  // TEST 8: Provider error
  it('retains stored data when Provider B returns HTTP 503', async () => {
    // Pre-seed some data via Provider B
    const aggregation = new AggregationService(db);
    aggregation.ingestProviderBScore(
      'match-1001',
      { sequence: 5, revision: 1, status: 'live', innings: 1, runs: 50, wickets: 0, overs: '5.0' },
      null,
    );
    aggregation.ingestProviderBCommentary('match-1001', [
      { ballId: 'b1', sequence: 1, revision: 1, innings: 1, over: 0, ball: 1, text: 'Existing ball.' },
    ]);

    // Mock returns 503 for both endpoints
    const mockFetch = createMockFetch(
      { status: 503, body: { error: 'Service unavailable' } },
      { status: 503, body: { error: 'Service unavailable' } },
    );

    const poller = createPoller(db, {
      baseUrl: 'http://mock-provider-b',
      intervalMs: 60000,
      fetchImpl: mockFetch,
    });

    const result = await poller.pollOnce();
    expect(result.kind).toBe('failed');

    // Data should still be available
    const snapshot = aggregation.getSnapshot('provider-b', 'match-1001');
    expect(snapshot?.runs).toBe(50);

    const commentary = aggregation.getCommentary('provider-b', 'match-1001');
    expect(commentary).toHaveLength(1);
  });

  it('processes commentary even when score endpoint fails', async () => {
    const aggregation = new AggregationService(db);

    // Score fails, commentary succeeds
    const mockFetch = createMockFetch(
      { status: 503, body: { error: 'Score unavailable' } },
      {
        status: 200,
        body: makeCommentaryResponse([
          { ballId: 'b1', sequence: 1, revision: 1, innings: 1, over: 0, ball: 1, text: 'Commentary works.', occurredAt: '2026-10-22T14:00:00.000Z' },
        ]),
      },
    );

    const poller = createPoller(db, {
      baseUrl: 'http://mock-provider-b',
      intervalMs: 60000,
      fetchImpl: mockFetch,
    });

    const result = await poller.pollOnce();
    expect(result.kind).toBe('partial');

    // Commentary should be stored even though score failed
    const items = aggregation.getCommentary('provider-b', 'match-1001');
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toBe('Commentary works.');
  });
});
