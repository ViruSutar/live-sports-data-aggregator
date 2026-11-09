/**
 * Unit/integration tests for commentary aggregation logic.
 * Tests ballId identity, revision corrections, duplicate prevention, sequence ordering.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, seedDatabase, type DatabaseHandle } from '../../src/database/connection.js';
import { AggregationService } from '../../src/modules/aggregation/aggregation.service.js';

let db: DatabaseHandle;
let aggregation: AggregationService;

beforeEach(() => {
  db = createDatabase(':memory:');
  seedDatabase(db);
  aggregation = new AggregationService(db);
});

afterEach(() => {
  db.close();
});

describe('Commentary Service', () => {
  it('creates a new record for a new ballId', () => {
    const result = aggregation.ingestProviderAEvent(
      'match-1001',
      'd-comm-1',
      undefined,
      { ballId: 'b1', sequence: 1, revision: 1, innings: 1, over: 0, ball: 1, text: 'New ball.' },
      null,
    );

    expect(result.commentaryInserted).toBe(1);
    const items = aggregation.getCommentary('provider-a', 'match-1001');
    expect(items).toHaveLength(1);
    expect(items[0]!.text).toBe('New ball.');
  });

  it('updates existing ball when revision is higher', () => {
    // Insert revision 1
    aggregation.ingestProviderAEvent(
      'match-1001',
      'd-comm-2',
      undefined,
      { ballId: 'b1', sequence: 1, revision: 1, innings: 1, over: 0, ball: 1, text: 'Version 1.' },
      null,
    );

    // Update with revision 2
    aggregation.ingestProviderAEvent(
      'match-1001',
      'd-comm-3',
      undefined,
      { ballId: 'b1', sequence: 1, revision: 2, innings: 1, over: 0, ball: 1, text: 'Version 2 (corrected).' },
      null,
    );

    const items = aggregation.getCommentary('provider-a', 'match-1001');
    expect(items).toHaveLength(1);
    expect(items[0]!.text).toBe('Version 2 (corrected).');
    expect(items[0]!.revision).toBe(2);
  });

  it('does not update when revision is equal', () => {
    aggregation.ingestProviderAEvent(
      'match-1001',
      'd-comm-4',
      undefined,
      { ballId: 'b1', sequence: 1, revision: 1, innings: 1, over: 0, ball: 1, text: 'Original.' },
      null,
    );

    aggregation.ingestProviderAEvent(
      'match-1001',
      'd-comm-5',
      undefined,
      { ballId: 'b1', sequence: 1, revision: 1, innings: 1, over: 0, ball: 1, text: 'Should not replace.' },
      null,
    );

    const items = aggregation.getCommentary('provider-a', 'match-1001');
    expect(items).toHaveLength(1);
    expect(items[0]!.text).toBe('Original.');
  });

  it('does not update when revision is lower', () => {
    aggregation.ingestProviderAEvent(
      'match-1001',
      'd-comm-6',
      undefined,
      { ballId: 'b1', sequence: 1, revision: 3, innings: 1, over: 0, ball: 1, text: 'Revision 3.' },
      null,
    );

    aggregation.ingestProviderAEvent(
      'match-1001',
      'd-comm-7',
      undefined,
      { ballId: 'b1', sequence: 1, revision: 1, innings: 1, over: 0, ball: 1, text: 'Old revision.' },
      null,
    );

    const items = aggregation.getCommentary('provider-a', 'match-1001');
    expect(items[0]!.revision).toBe(3);
    expect(items[0]!.text).toBe('Revision 3.');
  });

  it('never creates duplicate logical balls per provider', () => {
    // Multiple inserts with the same ballId
    for (let i = 1; i <= 5; i++) {
      aggregation.ingestProviderBCommentary('match-1001', [
        { ballId: 'unique-ball', sequence: 1, revision: 1, innings: 1, over: 0, ball: 1, text: `Attempt ${i}` },
      ]);
    }

    const items = aggregation.getCommentary('provider-b', 'match-1001');
    expect(items).toHaveLength(1);
  });

  it('returns commentary ordered by sequence ascending', () => {
    // Insert out of order
    aggregation.ingestProviderBCommentary('match-1001', [
      { ballId: 'b5', sequence: 5, revision: 1, innings: 1, over: 0, ball: 5, text: 'Fifth' },
      { ballId: 'b1', sequence: 1, revision: 1, innings: 1, over: 0, ball: 1, text: 'First' },
      { ballId: 'b3', sequence: 3, revision: 1, innings: 1, over: 0, ball: 3, text: 'Third' },
    ]);

    const items = aggregation.getCommentary('provider-b', 'match-1001');
    expect(items.map((i) => i.sequence)).toEqual([1, 3, 5]);
  });

  it('keeps provider commentary independent', () => {
    // Same ballId from different providers
    aggregation.ingestProviderAEvent(
      'match-1001',
      'd-comm-prov-a',
      undefined,
      { ballId: 'shared-ball', sequence: 1, revision: 1, innings: 1, over: 0, ball: 1, text: 'From A.' },
      null,
    );

    aggregation.ingestProviderBCommentary('match-1001', [
      { ballId: 'shared-ball', sequence: 1, revision: 1, innings: 1, over: 0, ball: 1, text: 'From B.' },
    ]);

    const itemsA = aggregation.getCommentary('provider-a', 'match-1001');
    const itemsB = aggregation.getCommentary('provider-b', 'match-1001');

    expect(itemsA).toHaveLength(1);
    expect(itemsA[0]!.text).toBe('From A.');
    expect(itemsB).toHaveLength(1);
    expect(itemsB[0]!.text).toBe('From B.');
  });
});
