/**
 * Integration tests for client-facing match APIs.
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

describe('Client-facing Match APIs', () => {
  it('GET /matches returns all known matches', async () => {
    const res = await request(app).get('/matches').expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('match-1001');
    expect(res.body.data[0].name).toBeTruthy();
  });

  it('GET /matches/:id returns 404 for unknown match', async () => {
    await request(app).get('/matches/nonexistent').expect(404);
  });

  it('GET /matches/:id/score returns 404 when no score exists', async () => {
    const res = await request(app).get('/matches/match-1001/score').expect(404);
    expect(res.body.error).toContain('No score available');
  });

  it('GET /matches/:id/commentary returns empty items when no commentary exists', async () => {
    const res = await request(app).get('/matches/match-1001/commentary').expect(200);
    expect(res.body.data.items).toHaveLength(0);
  });

  it('commentary is ordered by sequence ascending with ballId tiebreaker', async () => {
    const aggregation = new AggregationService(db);
    // Insert out of sequence order
    aggregation.ingestProviderAEvent(
      'match-1001',
      'd-1',
      { sequence: 1, revision: 1, status: 'live', innings: 1, runs: 5, wickets: 0, overs: '0.3' },
      { ballId: 'z-ball', sequence: 3, revision: 1, innings: 1, over: 0, ball: 3, text: 'Third ball' },
      null,
    );
    aggregation.ingestProviderAEvent(
      'match-1001',
      'd-2',
      undefined,
      { ballId: 'a-ball', sequence: 1, revision: 1, innings: 1, over: 0, ball: 1, text: 'First ball' },
      null,
    );
    aggregation.ingestProviderAEvent(
      'match-1001',
      'd-3',
      undefined,
      { ballId: 'm-ball', sequence: 2, revision: 1, innings: 1, over: 0, ball: 2, text: 'Second ball' },
      null,
    );

    const res = await request(app).get('/matches/match-1001/commentary').expect(200);
    const items = res.body.data.items;
    expect(items).toHaveLength(3);
    expect(items[0].sequence).toBe(1);
    expect(items[1].sequence).toBe(2);
    expect(items[2].sequence).toBe(3);
  });
});
