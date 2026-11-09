import { z } from 'zod';

/**
 * Zod schemas for validating external provider payloads.
 * All validation happens at the boundary before data enters the aggregation engine.
 */

/** Score snapshot schema — shared between providers */
export const snapshotSchema = z.object({
  sequence: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  status: z.string().min(1).max(64),
  innings: z.number().int().nonnegative(),
  runs: z.number().int().nonnegative(),
  wickets: z.number().int().nonnegative(),
  overs: z.string(),
});

/** Commentary item schema — shared between providers */
export const commentaryItemSchema = z.object({
  ballId: z.string().min(1).max(128),
  sequence: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  innings: z.number().int().nonnegative(),
  over: z.number().int().nonnegative(),
  ball: z.number().int().nonnegative(),
  text: z.string().min(1).max(2000),
});

/**
 * Provider A webhook payload schema.
 * snapshot and commentary are individually optional.
 */
export const providerAEventSchema = z.object({
  provider: z.literal('provider-a'),
  deliveryId: z.string().min(1).max(128),
  occurredAt: z.string(),
  providerMatchId: z.string().min(1).max(128),
  snapshot: snapshotSchema.optional(),
  commentary: commentaryItemSchema.optional(),
});

/** Provider B score response schema */
export const providerBScoreSchema = z.object({
  provider: z.literal('provider-b'),
  providerMatchId: z.string().min(1).max(128),
  snapshot: snapshotSchema.extend({
    asOf: z.string(),
  }),
});

/** Provider B commentary response schema */
export const providerBCommentarySchema = z.object({
  provider: z.literal('provider-b'),
  providerMatchId: z.string().min(1).max(128),
  items: z.array(
    commentaryItemSchema.extend({
      occurredAt: z.string(),
    }),
  ),
});

export type ValidatedSnapshot = z.infer<typeof snapshotSchema>;
export type ValidatedCommentaryItem = z.infer<typeof commentaryItemSchema>;
export type ValidatedProviderAEvent = z.infer<typeof providerAEventSchema>;
export type ValidatedProviderBScore = z.infer<typeof providerBScoreSchema>;
export type ValidatedProviderBCommentary = z.infer<typeof providerBCommentarySchema>;
