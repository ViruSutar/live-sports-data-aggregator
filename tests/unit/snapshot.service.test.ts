/**
 * Unit tests for snapshot.service.ts — snapshot version comparison logic.
 */
import { describe, it, expect } from 'vitest';
import {
  compareSnapshotVersion,
  isNewerSnapshot,
  isNewerCommentaryRevision,
} from '../../src/modules/aggregation/snapshot.service.js';

describe('compareSnapshotVersion', () => {
  it('returns 1 when incoming sequence is higher (regardless of revision)', () => {
    expect(compareSnapshotVersion({ sequence: 5, revision: 0 }, { sequence: 4, revision: 99 })).toBe(1);
    expect(compareSnapshotVersion({ sequence: 5, revision: 1 }, { sequence: 4, revision: 9 })).toBe(1);
  });

  it('returns 1 when sequences are equal and incoming revision is higher', () => {
    expect(compareSnapshotVersion({ sequence: 4, revision: 2 }, { sequence: 4, revision: 1 })).toBe(1);
  });

  it('returns 0 when both sequence and revision are equal', () => {
    expect(compareSnapshotVersion({ sequence: 4, revision: 1 }, { sequence: 4, revision: 1 })).toBe(0);
    expect(compareSnapshotVersion({ sequence: 5, revision: 1 }, { sequence: 5, revision: 1 })).toBe(0);
  });

  it('returns -1 when incoming sequence is lower (regardless of revision)', () => {
    expect(compareSnapshotVersion({ sequence: 4, revision: 9 }, { sequence: 5, revision: 1 })).toBe(-1);
  });

  it('returns -1 when sequences are equal and incoming revision is lower', () => {
    expect(compareSnapshotVersion({ sequence: 4, revision: 1 }, { sequence: 4, revision: 2 })).toBe(-1);
  });
});

describe('isNewerSnapshot', () => {
  it('returns true only when strictly newer', () => {
    expect(isNewerSnapshot({ sequence: 5, revision: 1 }, { sequence: 4, revision: 1 })).toBe(true);
    expect(isNewerSnapshot({ sequence: 4, revision: 2 }, { sequence: 4, revision: 1 })).toBe(true);
  });

  it('returns false for equal versions', () => {
    expect(isNewerSnapshot({ sequence: 4, revision: 1 }, { sequence: 4, revision: 1 })).toBe(false);
  });

  it('returns false for older versions', () => {
    expect(isNewerSnapshot({ sequence: 3, revision: 1 }, { sequence: 4, revision: 1 })).toBe(false);
    expect(isNewerSnapshot({ sequence: 4, revision: 1 }, { sequence: 4, revision: 2 })).toBe(false);
  });
});

describe('isNewerCommentaryRevision', () => {
  it('returns true when incoming revision is strictly higher', () => {
    expect(isNewerCommentaryRevision(2, 1)).toBe(true);
    expect(isNewerCommentaryRevision(10, 5)).toBe(true);
  });

  it('returns false for equal revisions', () => {
    expect(isNewerCommentaryRevision(1, 1)).toBe(false);
  });

  it('returns false for lower revisions', () => {
    expect(isNewerCommentaryRevision(1, 2)).toBe(false);
  });
});
