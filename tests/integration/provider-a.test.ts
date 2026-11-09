/**
 * Integration tests for Provider A webhook ingestion.
 * Tests: ordered ingestion, duplicate delivery, out-of-order events,
 *        snapshot-only and commentary-only events.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createDatabase, seedDatabase, type DatabaseHandle } from '../../src/database/connection.js';
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

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'provider-a',
    deliveryId: 'd-test-1',
    occurredAt: '2026-10-22T14:00:00.000Z',
    providerMatchId: 'a-match-1001',
    snapshot: {
      sequence: 1,
      revision: 1,
      status: 'live',
      innings: 1,
      runs: 10,
      wickets: 0,
      overs: '1.4',
    },
    commentary: {
      ballId: 'inn1-1.4',
      sequence: 1,
      revision: 1,
      innings: 1,
      over: 1,
      ball: 4,
      text: 'Boundary! Four runs.',
    },
    ...overrides,
  };
}

describe('Provider A Integration', () => {
  // TEST 1: Ordered ingestion
  it('accepts ordered events and stores score and commentary', async () => {
    // Send first event
    const res1 = await request(app)
      .post('/webhooks/provider-a')
      .send(makeEvent({ deliveryId: 'd-1' }))
      .expect(200);

    expect(res1.body.success).toBe(true);
    expect(res1.body.duplicate).toBe(false);

    // Send second event with higher sequence
    const res2 = await request(app)
      .post('/webhooks/provider-a')
      .send(
        makeEvent({
          deliveryId: 'd-2',
          snapshot: { sequence: 2, revision: 1, status: 'live', innings: 1, runs: 14, wickets: 0, overs: '1.5' },
          commentary: { ballId: 'inn1-1.5', sequence: 2, revision: 1, innings: 1, over: 1, ball: 5, text: 'Four more runs.' },
        }),
      )
      .expect(200);

    expect(res2.body.success).toBe(true);

    // Verify final score
    const scoreRes = await request(app).get('/matches/match-1001/score').expect(200);
    expect(scoreRes.body.data.runs).toBe(14);
    expect(scoreRes.body.data.overs).toBe('1.5');

    // Verify commentary
    const commRes = await request(app).get('/matches/match-1001/commentary').expect(200);
    expect(commRes.body.data.items).toHaveLength(2);
    expect(commRes.body.data.items[0].ballId).toBe('inn1-1.4');
    expect(commRes.body.data.items[1].ballId).toBe('inn1-1.5');
  });

  // TEST 2: Duplicate push delivery
  it('acknowledges duplicate deliveryId without changing state', async () => {
    const payload = makeEvent({ deliveryId: 'd-dup-1' });

    // First delivery
    const res1 = await request(app).post('/webhooks/provider-a').send(payload).expect(200);
    expect(res1.body.duplicate).toBe(false);

    // Second delivery with same deliveryId — should be a duplicate
    const res2 = await request(app).post('/webhooks/provider-a').send(payload).expect(200);
    expect(res2.body.duplicate).toBe(true);

    // Third delivery with same deliveryId but DIFFERENT data — still duplicate
    const res3 = await request(app)
      .post('/webhooks/provider-a')
      .send(
        makeEvent({
          deliveryId: 'd-dup-1',
          snapshot: { sequence: 99, revision: 1, status: 'live', innings: 1, runs: 999, wickets: 9, overs: '50.0' },
        }),
      )
      .expect(200);
    expect(res3.body.duplicate).toBe(true);

    // Verify state is unchanged from first delivery
    const scoreRes = await request(app).get('/matches/match-1001/score').expect(200);
    expect(scoreRes.body.data.runs).toBe(10); // Original, not 999
  });

  // TEST 3: Out-of-order snapshot
  it('preserves newer snapshot when older one arrives late, but still stores late commentary', async () => {
    // Send sequence 10
    await request(app)
      .post('/webhooks/provider-a')
      .send(
        makeEvent({
          deliveryId: 'd-seq10',
          snapshot: { sequence: 10, revision: 1, status: 'live', innings: 1, runs: 50, wickets: 2, overs: '10.0' },
          commentary: { ballId: 'b10', sequence: 10, revision: 1, innings: 1, over: 10, ball: 0, text: 'Ball 10' },
        }),
      )
      .expect(200);

    // Send sequence 12 (newer)
    await request(app)
      .post('/webhooks/provider-a')
      .send(
        makeEvent({
          deliveryId: 'd-seq12',
          snapshot: { sequence: 12, revision: 1, status: 'live', innings: 1, runs: 62, wickets: 2, overs: '12.0' },
          commentary: { ballId: 'b12', sequence: 12, revision: 1, innings: 1, over: 12, ball: 0, text: 'Ball 12' },
        }),
      )
      .expect(200);

    // Send sequence 11 (DELAYED, out of order)
    await request(app)
      .post('/webhooks/provider-a')
      .send(
        makeEvent({
          deliveryId: 'd-seq11',
          snapshot: { sequence: 11, revision: 1, status: 'live', innings: 1, runs: 56, wickets: 2, overs: '11.0' },
          commentary: { ballId: 'b11', sequence: 11, revision: 1, innings: 1, over: 11, ball: 0, text: 'Ball 11' },
        }),
      )
      .expect(200);

    // Snapshot should remain at sequence 12
    const scoreRes = await request(app).get('/matches/match-1001/score').expect(200);
    expect(scoreRes.body.data.runs).toBe(62);

    // Commentary should contain all 3 balls, ordered by sequence
    const commRes = await request(app).get('/matches/match-1001/commentary').expect(200);
    expect(commRes.body.data.items).toHaveLength(3);
    expect(commRes.body.data.items[0].ballId).toBe('b10');
    expect(commRes.body.data.items[1].ballId).toBe('b11');
    expect(commRes.body.data.items[2].ballId).toBe('b12');
  });

  // TEST 4: Commentary correction
  it('updates commentary text when same ballId arrives with higher revision', async () => {
    // Send ball b1 with revision 1
    await request(app)
      .post('/webhooks/provider-a')
      .send(
        makeEvent({
          deliveryId: 'd-rev1',
          commentary: { ballId: 'b1', sequence: 1, revision: 1, innings: 1, over: 0, ball: 1, text: 'Original text.' },
        }),
      )
      .expect(200);

    // Send same ballId with revision 2 (correction)
    await request(app)
      .post('/webhooks/provider-a')
      .send(
        makeEvent({
          deliveryId: 'd-rev2',
          snapshot: { sequence: 2, revision: 1, status: 'live', innings: 1, runs: 12, wickets: 0, overs: '2.0' },
          commentary: { ballId: 'b1', sequence: 1, revision: 2, innings: 1, over: 0, ball: 1, text: 'CORRECTED text.' },
        }),
      )
      .expect(200);

    // Only one record for b1, with corrected text
    const commRes = await request(app).get('/matches/match-1001/commentary').expect(200);
    const b1Items = commRes.body.data.items.filter((i: { ballId: string }) => i.ballId === 'b1');
    expect(b1Items).toHaveLength(1);
    expect(b1Items[0].text).toBe('CORRECTED text.');
    expect(b1Items[0].revision).toBe(2);
  });

  // TEST 5: Snapshot correction (same sequence, higher revision)
  it('accepts snapshot with same sequence but higher revision', async () => {
    // Send snapshot (4, 1)
    await request(app)
      .post('/webhooks/provider-a')
      .send(
        makeEvent({
          deliveryId: 'd-snap1',
          snapshot: { sequence: 4, revision: 1, status: 'live', innings: 1, runs: 30, wickets: 1, overs: '4.0' },
        }),
      )
      .expect(200);

    // Send snapshot (4, 2) — same sequence, higher revision
    await request(app)
      .post('/webhooks/provider-a')
      .send(
        makeEvent({
          deliveryId: 'd-snap2',
          snapshot: { sequence: 4, revision: 2, status: 'live', innings: 1, runs: 28, wickets: 1, overs: '4.0' },
        }),
      )
      .expect(200);

    // Verify the corrected snapshot is stored
    const scoreRes = await request(app).get('/matches/match-1001/score').expect(200);
    expect(scoreRes.body.data.runs).toBe(28); // Corrected value
  });

  // TEST 12: Snapshot-only and commentary-only events
  it('handles snapshot-only events without affecting commentary', async () => {
    // Send event with both
    await request(app)
      .post('/webhooks/provider-a')
      .send(
        makeEvent({
          deliveryId: 'd-both',
          snapshot: { sequence: 1, revision: 1, status: 'live', innings: 1, runs: 5, wickets: 0, overs: '0.3' },
          commentary: { ballId: 'b1', sequence: 1, revision: 1, innings: 1, over: 0, ball: 3, text: 'Dot ball.' },
        }),
      )
      .expect(200);

    // Send snapshot-only event (no commentary key)
    await request(app)
      .post('/webhooks/provider-a')
      .send({
        provider: 'provider-a',
        deliveryId: 'd-snap-only',
        occurredAt: '2026-10-22T14:02:00.000Z',
        providerMatchId: 'a-match-1001',
        snapshot: { sequence: 2, revision: 1, status: 'live', innings: 1, runs: 9, wickets: 0, overs: '0.4' },
        // No commentary
      })
      .expect(200);

    // Score should update
    const scoreRes = await request(app).get('/matches/match-1001/score').expect(200);
    expect(scoreRes.body.data.runs).toBe(9);

    // Commentary should still have the original ball
    const commRes = await request(app).get('/matches/match-1001/commentary').expect(200);
    expect(commRes.body.data.items).toHaveLength(1);
    expect(commRes.body.data.items[0].text).toBe('Dot ball.');
  });

  it('handles commentary-only events without affecting snapshot', async () => {
    // Send initial event with snapshot
    await request(app)
      .post('/webhooks/provider-a')
      .send(
        makeEvent({
          deliveryId: 'd-init',
          snapshot: { sequence: 5, revision: 1, status: 'live', innings: 1, runs: 30, wickets: 1, overs: '5.0' },
        }),
      )
      .expect(200);

    // Send commentary-only event (no snapshot key)
    await request(app)
      .post('/webhooks/provider-a')
      .send({
        provider: 'provider-a',
        deliveryId: 'd-comm-only',
        occurredAt: '2026-10-22T14:03:00.000Z',
        providerMatchId: 'a-match-1001',
        commentary: { ballId: 'b-late', sequence: 3, revision: 1, innings: 1, over: 3, ball: 0, text: 'Late commentary.' },
        // No snapshot
      })
      .expect(200);

    // Score should remain unchanged
    const scoreRes = await request(app).get('/matches/match-1001/score').expect(200);
    expect(scoreRes.body.data.runs).toBe(30);

    // Commentary should have the new ball
    const commRes = await request(app).get('/matches/match-1001/commentary').expect(200);
    expect(commRes.body.data.items.some((i: { ballId: string }) => i.ballId === 'b-late')).toBe(true);
  });

  it('rejects malformed payload with 400', async () => {
    const res = await request(app)
      .post('/webhooks/provider-a')
      .send({ garbage: true })
      .expect(400);

    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 404 for unknown match ID', async () => {
    const res = await request(app).get('/matches/nonexistent').expect(404);
    expect(res.body.error).toContain('not found');
  });
});
