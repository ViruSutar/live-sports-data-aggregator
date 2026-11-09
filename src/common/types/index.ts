/** Provider identifier type */
export type Provider = 'provider-a' | 'provider-b';

/** Snapshot version tuple for ordering comparisons */
export interface SnapshotVersion {
  sequence: number;
  revision: number;
}

/** Score data exactly as supplied by providers */
export interface MatchScore {
  innings: number;
  runs: number;
  wickets: number;
  /** Overs remain strings exactly as provided, e.g. "12.4" */
  overs: string;
}

/** Snapshot payload from a provider */
export interface ProviderSnapshot extends SnapshotVersion {
  status: string;
  innings: number;
  runs: number;
  wickets: number;
  overs: string;
}

/** Commentary item payload from a provider */
export interface ProviderCommentaryItem {
  ballId: string;
  sequence: number;
  revision: number;
  innings: number;
  over: number;
  ball: number;
  text: string;
}

/** Provider A webhook event payload */
export interface ProviderAEvent {
  provider: 'provider-a';
  deliveryId: string;
  occurredAt: string;
  providerMatchId: string;
  snapshot?: ProviderSnapshot;
  commentary?: ProviderCommentaryItem;
}

/** Provider B score response */
export interface ProviderBScoreResponse {
  provider: 'provider-b';
  providerMatchId: string;
  snapshot: ProviderSnapshot & { asOf: string };
}

/** Provider B commentary response */
export interface ProviderBCommentaryResponse {
  provider: 'provider-b';
  providerMatchId: string;
  items: Array<ProviderCommentaryItem & { occurredAt: string }>;
}

/** Stored snapshot record from the database */
export interface StoredSnapshot extends SnapshotVersion {
  id: number;
  provider: Provider;
  matchId: string;
  status: string;
  innings: number;
  runs: number;
  wickets: number;
  overs: string;
  providerTimestamp: string | null;
  updatedAt: string;
}

/** Stored commentary record from the database */
export interface StoredCommentary {
  id: number;
  provider: Provider;
  matchId: string;
  ballId: string;
  sequence: number;
  revision: number;
  innings: number;
  over: number;
  ball: number;
  text: string;
  occurredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Match record from the database */
export interface Match {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** Provider match mapping record */
export interface ProviderMatchMapping {
  id: number;
  provider: Provider;
  providerMatchId: string;
  matchId: string;
  createdAt: string;
}

/** Aggregation result returned after ingestion */
export interface IngestResult {
  duplicate: boolean;
  snapshotUpdated: boolean;
  commentaryInserted: number;
  commentaryUpdated: number;
}

/** Client-facing match summary */
export interface MatchSummary {
  id: string;
  name: string;
  status: string | null;
  score: {
    innings: number;
    runs: number;
    wickets: number;
    overs: string;
  } | null;
}

/** Client-facing match detail */
export interface MatchDetail extends MatchSummary {
  provider: Provider | null;
}

/** Client-facing score response */
export interface ScoreResponse {
  matchId: string;
  provider: Provider;
  status: string;
  innings: number;
  runs: number;
  wickets: number;
  overs: string;
}

/** Client-facing commentary item */
export interface CommentaryResponse {
  ballId: string;
  sequence: number;
  revision: number;
  innings: number;
  over: number;
  ball: number;
  text: string;
}
