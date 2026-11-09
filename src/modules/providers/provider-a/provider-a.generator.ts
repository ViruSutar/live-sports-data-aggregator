/**
 * Deterministic Provider A event generator.
 * Sends a scripted sequence of webhook events to demonstrate:
 * 1. Ordered delivery
 * 2. Repeated deliveryId (duplicate)
 * 3. Higher commentary sequence arriving before lower sequence
 * 4. Delayed older snapshot
 * 5. Commentary correction using same ballId with higher revision
 * 6. Snapshot correction using same sequence but higher revision
 * 7. Snapshot-only and commentary-only events
 */
import type { ValidatedProviderAEvent } from '../../aggregation/aggregation.types.js';

export interface GeneratorEvent {
  name: string;
  description: string;
  payload: ValidatedProviderAEvent;
  expectedOutcome: string;
}

/**
 * Returns a deterministic, ordered list of Provider A events.
 * No randomness — every run produces the same sequence.
 */
export function generateProviderAEvents(): GeneratorEvent[] {
  const providerMatchId = 'a-match-1001';
  const now = new Date('2026-10-22T14:00:00.000Z');

  function ts(offsetMinutes: number): string {
    return new Date(now.getTime() + offsetMinutes * 60_000).toISOString();
  }

  return [
    // Event 1: Normal ordered delivery with snapshot + commentary
    {
      name: 'Event 1: Normal ordered delivery',
      description: 'First ball — standard delivery with snapshot and commentary',
      payload: {
        provider: 'provider-a',
        deliveryId: 'd-1001',
        occurredAt: ts(1),
        providerMatchId,
        snapshot: {
          sequence: 1,
          revision: 1,
          status: 'live',
          innings: 1,
          runs: 4,
          wickets: 0,
          overs: '0.1',
        },
        commentary: {
          ballId: 'inn1-0.1',
          sequence: 1,
          revision: 1,
          innings: 1,
          over: 0,
          ball: 1,
          text: 'Short ball, pulled away to the boundary for four!',
        },
      },
      expectedOutcome: 'Snapshot and commentary accepted. First data point for Provider A.',
    },

    // Event 2: Second ordered delivery
    {
      name: 'Event 2: Second ordered delivery',
      description: 'Second ball — advances the match',
      payload: {
        provider: 'provider-a',
        deliveryId: 'd-1002',
        occurredAt: ts(2),
        providerMatchId,
        snapshot: {
          sequence: 2,
          revision: 1,
          status: 'live',
          innings: 1,
          runs: 5,
          wickets: 0,
          overs: '0.2',
        },
        commentary: {
          ballId: 'inn1-0.2',
          sequence: 2,
          revision: 1,
          innings: 1,
          over: 0,
          ball: 2,
          text: 'Good length, pushed to mid-on for a single.',
        },
      },
      expectedOutcome: 'Snapshot updated to seq 2. New commentary ball created.',
    },

    // Event 3: Duplicate delivery (same deliveryId as Event 1)
    {
      name: 'Event 3: DUPLICATE — same deliveryId as Event 1',
      description: 'Provider retries d-1001 after timeout. Must be idempotent.',
      payload: {
        provider: 'provider-a',
        deliveryId: 'd-1001', // Same as Event 1!
        occurredAt: ts(3),
        providerMatchId,
        snapshot: {
          sequence: 1,
          revision: 1,
          status: 'live',
          innings: 1,
          runs: 4,
          wickets: 0,
          overs: '0.1',
        },
        commentary: {
          ballId: 'inn1-0.1',
          sequence: 1,
          revision: 1,
          innings: 1,
          over: 0,
          ball: 1,
          text: 'Short ball, pulled away to the boundary for four!',
        },
      },
      expectedOutcome: 'DUPLICATE detected. No state changes. Response: { duplicate: true }.',
    },

    // Event 4: Higher sequence commentary arrives BEFORE lower sequence
    // Sends sequence 5 first
    {
      name: 'Event 4: OUT-OF-ORDER — sequence 5 arrives before sequence 4',
      description: 'Commentary with sequence 5 arrives before sequence 4 (out of order)',
      payload: {
        provider: 'provider-a',
        deliveryId: 'd-1005',
        occurredAt: ts(5),
        providerMatchId,
        snapshot: {
          sequence: 5,
          revision: 1,
          status: 'live',
          innings: 1,
          runs: 22,
          wickets: 0,
          overs: '0.5',
        },
        commentary: {
          ballId: 'inn1-0.5',
          sequence: 5,
          revision: 1,
          innings: 1,
          over: 0,
          ball: 5,
          text: 'Full toss, driven through the covers for four!',
        },
      },
      expectedOutcome: 'Snapshot jumps to seq 5. Commentary ball 0.5 stored at sequence 5.',
    },

    // Event 5: Now sequence 4 arrives (delayed, out of order)
    {
      name: 'Event 5: DELAYED — sequence 4 arrives after sequence 5',
      description: 'Delayed older snapshot. Snapshot rejected, commentary still accepted.',
      payload: {
        provider: 'provider-a',
        deliveryId: 'd-1004',
        occurredAt: ts(4),
        providerMatchId,
        snapshot: {
          sequence: 4,
          revision: 1,
          status: 'live',
          innings: 1,
          runs: 18,
          wickets: 0,
          overs: '0.4',
        },
        commentary: {
          ballId: 'inn1-0.4',
          sequence: 4,
          revision: 1,
          innings: 1,
          over: 0,
          ball: 4,
          text: 'Short outside off, cut behind point for two.',
        },
      },
      expectedOutcome:
        'Snapshot REJECTED (seq 4 < stored seq 5). Commentary ball 0.4 INSERTED (new ball).',
    },

    // Event 6: Commentary correction — same ballId, higher revision
    {
      name: 'Event 6: COMMENTARY CORRECTION — ball inn1-0.2 revised',
      description:
        'Same ballId as Event 2 but revision 2. Text should be updated.',
      payload: {
        provider: 'provider-a',
        deliveryId: 'd-1006',
        occurredAt: ts(6),
        providerMatchId,
        snapshot: {
          sequence: 6,
          revision: 1,
          status: 'live',
          innings: 1,
          runs: 23,
          wickets: 0,
          overs: '1.0',
        },
        commentary: {
          ballId: 'inn1-0.2', // Same ball as Event 2
          sequence: 2,
          revision: 2, // Higher revision
          innings: 1,
          over: 0,
          ball: 2,
          text: 'CORRECTION: Good length on off stump, defended to cover. No run.',
        },
      },
      expectedOutcome:
        'Snapshot updated to seq 6. Commentary ball inn1-0.2 UPDATED to revision 2 with corrected text.',
    },

    // Event 7: Snapshot correction — same sequence, higher revision
    {
      name: 'Event 7: SNAPSHOT CORRECTION — same sequence 6, revision 2',
      description:
        'Score correction for the same sequence. Revision 2 > revision 1, so accepted.',
      payload: {
        provider: 'provider-a',
        deliveryId: 'd-1007',
        occurredAt: ts(7),
        providerMatchId,
        snapshot: {
          sequence: 6,
          revision: 2, // Higher revision, same sequence
          status: 'live',
          innings: 1,
          runs: 22, // Corrected runs (was 23, now 22 — a correction)
          wickets: 0,
          overs: '1.0',
        },
      },
      // No commentary — snapshot-only event
      expectedOutcome:
        'Snapshot UPDATED: same seq 6 but revision 2 > 1. runs corrected to 22. No commentary change.',
    },

    // Event 8: Commentary-only event (no snapshot)
    {
      name: 'Event 8: COMMENTARY-ONLY event — no snapshot section',
      description: 'Event that only contains commentary, no snapshot.',
      payload: {
        provider: 'provider-a',
        deliveryId: 'd-1008',
        occurredAt: ts(8),
        providerMatchId,
        commentary: {
          ballId: 'inn1-1.1',
          sequence: 7,
          revision: 1,
          innings: 1,
          over: 1,
          ball: 1,
          text: 'New bowler. Full and straight, defended solidly.',
        },
      },
      expectedOutcome:
        'No snapshot change (none in payload). Commentary ball inn1-1.1 INSERTED.',
    },

    // Event 9: Snapshot-only event (no commentary)
    {
      name: 'Event 9: SNAPSHOT-ONLY event — no commentary section',
      description: 'Event that only contains a snapshot update, no commentary.',
      payload: {
        provider: 'provider-a',
        deliveryId: 'd-1009',
        occurredAt: ts(9),
        providerMatchId,
        snapshot: {
          sequence: 8,
          revision: 1,
          status: 'live',
          innings: 1,
          runs: 28,
          wickets: 1,
          overs: '1.3',
        },
      },
      expectedOutcome:
        'Snapshot UPDATED to seq 8. No commentary change (none in payload).',
    },
  ];
}

/**
 * Sends all generated events to the aggregator webhook URL.
 * Logs the outcome of each event for review.
 */
export async function runProviderAGenerator(webhookUrl: string): Promise<void> {
  const events = generateProviderAEvents();

  console.log('='.repeat(80));
  console.log('PROVIDER A — DETERMINISTIC EVENT GENERATOR');
  console.log(`Target: ${webhookUrl}`);
  console.log(`Total events: ${events.length}`);
  console.log('='.repeat(80));

  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`[${i + 1}/${events.length}] ${event.name}`);
    console.log(`  Description: ${event.description}`);
    console.log(`  Expected: ${event.expectedOutcome}`);

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event.payload),
      });

      const body = await response.json();
      console.log(`  HTTP ${response.status}: ${JSON.stringify(body)}`);

      if (!response.ok) {
        console.log(`  ⚠ Unexpected status code: ${response.status}`);
      }
    } catch (error) {
      console.error(`  ✗ Request failed:`, error instanceof Error ? error.message : error);
    }

    // Small delay between events for readability
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('Generator complete. Verify results at:');
  console.log('  GET /matches');
  console.log('  GET /matches/match-1001');
  console.log('  GET /matches/match-1001/score');
  console.log('  GET /matches/match-1001/commentary');
  console.log('='.repeat(80));
}
