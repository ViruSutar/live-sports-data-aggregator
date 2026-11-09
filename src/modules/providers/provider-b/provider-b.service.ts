/**
 * Mock Provider B HTTP service.
 * Exposes deterministic, evolving match state endpoints:
 *   GET /provider/matches/:id/score
 *   GET /provider/matches/:id/commentary
 *
 * The mock supports scripted scenarios:
 *   1. Unchanged response (same data on repeated polls)
 *   2. Newer score
 *   3. New commentary item
 *   4. Stale score response with a recent timestamp
 *   5. Temporary HTTP 503
 *   6. Recovery after temporary failure
 *
 * Scenario progression is controlled by an internal step counter
 * that advances on each score request.
 */
import express, { type Express } from 'express';

export interface ProviderBMockState {
  step: number;
  score: {
    sequence: number;
    revision: number;
    status: string;
    innings: number;
    runs: number;
    wickets: number;
    overs: string;
  };
  commentary: Array<{
    ballId: string;
    sequence: number;
    revision: number;
    innings: number;
    over: number;
    ball: number;
    text: string;
    occurredAt: string;
  }>;
}

/**
 * Creates the mock Provider B Express app.
 * Each call to GET /provider/matches/:id/score advances the match state.
 */
export function createProviderBMock(): { app: Express; state: ProviderBMockState } {
  const app = express();
  app.disable('x-powered-by');

  const state: ProviderBMockState = {
    step: 0,
    score: {
      sequence: 1,
      revision: 1,
      status: 'live',
      innings: 1,
      runs: 10,
      wickets: 0,
      overs: '1.4',
    },
    commentary: [
      {
        ballId: 'inn1-1.1',
        sequence: 1,
        revision: 1,
        innings: 1,
        over: 1,
        ball: 1,
        text: 'Good length delivery, defended to cover.',
        occurredAt: '2026-10-22T14:00:01.000Z',
      },
      {
        ballId: 'inn1-1.2',
        sequence: 2,
        revision: 1,
        innings: 1,
        over: 1,
        ball: 2,
        text: 'Short ball, pulled to midwicket for two.',
        occurredAt: '2026-10-22T14:00:30.000Z',
      },
      {
        ballId: 'inn1-1.3',
        sequence: 3,
        revision: 1,
        innings: 1,
        over: 1,
        ball: 3,
        text: 'Full toss on leg, flicked for four runs.',
        occurredAt: '2026-10-22T14:01:00.000Z',
      },
      {
        ballId: 'inn1-1.4',
        sequence: 4,
        revision: 1,
        innings: 1,
        over: 1,
        ball: 4,
        text: 'Dot ball. Good yorker, dug out.',
        occurredAt: '2026-10-22T14:01:30.000Z',
      },
    ],
  };

  // Scenario progression on each score request
  function advanceState(): void {
    state.step++;

    switch (state.step) {
      case 1:
        // Step 1: Unchanged response (same as initial)
        break;

      case 2:
        // Step 2: Newer score
        state.score = {
          sequence: 2,
          revision: 1,
          status: 'live',
          innings: 1,
          runs: 15,
          wickets: 0,
          overs: '2.0',
        };
        // Step 3: New commentary item added
        state.commentary.push({
          ballId: 'inn1-2.0',
          sequence: 5,
          revision: 1,
          innings: 1,
          over: 2,
          ball: 0,
          text: 'Over completed. 5 runs from the over.',
          occurredAt: '2026-10-22T14:02:00.000Z',
        });
        break;

      case 3:
        // Step 4: Stale score with recent timestamp (sequence goes backward)
        state.score = {
          sequence: 1, // STALE — less than the current seq 2
          revision: 1,
          status: 'live',
          innings: 1,
          runs: 10,
          wickets: 0,
          overs: '1.4',
        };
        break;

      case 4:
        // Step 5: HTTP 503 — handled in route handler
        break;

      case 5:
        // Step 6: Recovery — back to normal with newer data
        state.score = {
          sequence: 3,
          revision: 1,
          status: 'live',
          innings: 1,
          runs: 22,
          wickets: 1,
          overs: '3.2',
        };
        state.commentary.push({
          ballId: 'inn1-3.2',
          sequence: 6,
          revision: 1,
          innings: 1,
          over: 3,
          ball: 2,
          text: 'WICKET! Caught at slip! The bowler strikes.',
          occurredAt: '2026-10-22T14:03:00.000Z',
        });
        break;

      default:
        // After all scenarios, stay at the last state
        break;
    }
  }

  /** GET /provider/matches/:id/score */
  app.get('/provider/matches/:id/score', (req, res) => {
    const matchId = req.params.id;
    if (matchId !== 'b-match-1001') {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    advanceState();

    // Step 5: Temporary 503
    if (state.step === 4) {
      console.log('[Mock Provider B] Returning 503 (simulated outage)');
      res.status(503).json({ error: 'Service temporarily unavailable' });
      return;
    }

    const response = {
      provider: 'provider-b' as const,
      providerMatchId: 'b-match-1001',
      snapshot: {
        ...state.score,
        asOf: new Date().toISOString(), // Fresh timestamp, even for stale data
      },
    };

    console.log(`[Mock Provider B] Score response: step=${state.step}, seq=${state.score.sequence}`);
    res.status(200).json(response);
  });

  /** GET /provider/matches/:id/commentary */
  app.get('/provider/matches/:id/commentary', (req, res) => {
    const matchId = req.params.id;
    if (matchId !== 'b-match-1001') {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    const response = {
      provider: 'provider-b' as const,
      providerMatchId: 'b-match-1001',
      items: state.commentary,
    };

    console.log(`[Mock Provider B] Commentary response: ${state.commentary.length} items`);
    res.status(200).json(response);
  });

  return { app, state };
}
