import type { SnapshotVersion } from '../../common/types/index.js';

/**
 * Compares two snapshot version tuples lexicographically.
 * Uses (sequence, revision) ordering — timestamps are never used.
 *
 * Returns:
 *  1  if left is newer than right
 *  0  if they are equal
 * -1  if left is older than right
 *
 * Examples:
 *   (5, 1) vs (4, 9) → 1  (higher sequence wins regardless of revision)
 *   (4, 2) vs (4, 1) → 1  (same sequence, higher revision wins)
 *   (4, 1) vs (4, 1) → 0  (identical, not newer)
 *   (4, 9) vs (5, 1) → -1 (lower sequence loses regardless of revision)
 */
export function compareSnapshotVersion(
  left: SnapshotVersion,
  right: SnapshotVersion,
): -1 | 0 | 1 {
  if (left.sequence > right.sequence) return 1;
  if (left.sequence < right.sequence) return -1;
  if (left.revision > right.revision) return 1;
  if (left.revision < right.revision) return -1;
  return 0;
}

/**
 * Returns true if the incoming snapshot is strictly newer than the stored one.
 * An equal version is NOT considered newer — we reject it.
 *
 * This function is the core building block for the atomic UPSERT WHERE clause.
 */
export function isNewerSnapshot(
  incoming: SnapshotVersion,
  existing: SnapshotVersion,
): boolean {
  return compareSnapshotVersion(incoming, existing) === 1;
}

/**
 * Returns true if the incoming commentary revision is strictly higher.
 * Commentary corrections are accepted only when revision increases.
 * Equal or lower revisions are rejected.
 */
export function isNewerCommentaryRevision(
  incomingRevision: number,
  storedRevision: number,
): boolean {
  return incomingRevision > storedRevision;
}
