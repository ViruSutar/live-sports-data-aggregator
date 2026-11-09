# Design: Live Sports Match Data Aggregator

## 1. Overview

The service receives live match updates from two providers with different delivery models: Provider A pushes webhook events, while Provider B is polled over HTTP. The backend stores provider-specific state and exposes a single client-facing match view.

The implementation is a **modular monolith**: one Node.js process, one Express application, and one SQLite database. Provider controllers/pollers handle transport concerns; `AggregationService` owns ingestion rules; repositories and `MatchService` handle persistence and read-model assembly.

```text
Provider A webhook ─┐
                    ├─> AggregationService ─> SQLite provider state
Provider B poller ──┘                              |
                                                   v
Client APIs <────────────────────────────── MatchService
```

Both providers are stored independently. The service does not compare Provider A's sequence values with Provider B's sequence values.

## 2. Data model

| Table | Key / constraint | Responsibility |
|---|---|---|
| `matches` | `id` primary key | Internal match record exposed to clients |
| `provider_match_mappings` | unique `(provider, provider_match_id)` | Maps each provider's external match ID to the internal match ID |
| `provider_score_snapshots` | unique `(provider, match_id)` | Holds the latest accepted snapshot from each provider |
| `provider_commentary` | unique `(provider, match_id, ball_id)` | Holds one logical commentary ball per provider and match |
| `processed_deliveries` | unique `(provider, delivery_id)` | Records Provider A webhook deliveries already committed |

The schema includes indexes for match mapping lookup, provider snapshot lookup, commentary ordered retrieval, and delivery deduplication. Foreign keys keep provider data associated with a known internal match.

### Why provider-specific rows are retained

Provider sequence numbers are only meaningful within the corresponding provider's stream. Keeping separate snapshots and commentary avoids invalid comparisons across providers and preserves each provider's latest accepted state. The client read layer applies one deterministic provider-selection rule.

## 3. Ingestion and ordering semantics

### Provider A — push

1. The Express controller validates the payload using Zod.
2. The provider match ID is resolved through `provider_match_mappings`.
3. `AggregationService.ingestProviderAEvent` opens an immediate SQLite transaction.
4. It inserts `(provider, deliveryId)` into `processed_deliveries` using a uniqueness constraint. If the insert is ignored because that delivery already exists, the event is treated as a duplicate and no data is changed.
5. An optional score snapshot is applied using a conditional UPSERT. An optional commentary item is applied using a separate conditional UPSERT.
6. The transaction commits before the controller returns HTTP `200`.

The delivery record and its snapshot/commentary mutations are in the same transaction. Therefore, a failure before commit rolls all of them back. If the commit succeeds but the HTTP response is lost, a provider retry with the same delivery ID is acknowledged as a duplicate. This is **at-least-once delivery with idempotent state changes**, not a claim of exactly-once network delivery.

The controller performs a preliminary duplicate lookup to avoid unnecessary work, but the unique constraint and duplicate check inside the transaction are the correctness boundary. The transactional check is still required for concurrent requests.

### Snapshot ordering

For a single provider and match, the tuple `(sequence, revision)` is compared lexicographically:

- A greater `sequence` is newer, regardless of revision.
- When `sequence` is equal, a greater `revision` is newer.
- An equal or lower tuple is rejected.

The rule is enforced in SQL, not by a JavaScript read-then-write sequence:

```sql
ON CONFLICT(provider, match_id)
DO UPDATE SET ...
WHERE excluded.sequence > provider_score_snapshots.sequence
   OR (
     excluded.sequence = provider_score_snapshots.sequence
     AND excluded.revision > provider_score_snapshots.revision
   )
```

This makes the comparison and write one database operation. SQLite serializes writers, and the application uses an immediate transaction for ingestion. Provider timestamps such as `occurredAt` and `asOf` do not determine snapshot precedence.

### Commentary ordering and correction

A commentary item's logical identity is `(provider, match_id, ballId)`. A new `ballId` creates a row. A higher revision updates that row; an equal or lower revision is ignored. Commentary is queried by ascending `sequence`, with `ballId` as a stable tie-breaker. A late-arriving ball is stored immediately and appears in its sequence position on the next read; the service does not wait for missing sequence numbers.

The aggregator stores provider-supplied score snapshots as-is. It does not derive runs, wickets, or overs from commentary. `overs` is a string field, not a numeric quantity to be recalculated.

### Provider B — polling

The poller calls the mock provider's score and commentary endpoints independently. It runs an immediate poll on startup and then repeats at the configured interval (5 seconds by default). The two requests are executed concurrently; a failure in one does not prevent processing a successful response from the other.

Provider B returns a full commentary list on each poll. The same identity/revision UPSERT rules make identical responses idempotent. There is no separate poll-delivery ID because the provider's current state is reconciled through versioned snapshots and logical commentary identities.

The poller has an in-flight guard: if a scheduled tick occurs while a previous cycle is still running, the new cycle is skipped rather than overlapped. Fetch requests use a 5-second timeout. Non-2xx responses, invalid payloads, and network errors are logged and reported by the poll result. Failed responses do not delete or overwrite previously committed data, so the last good state remains readable.

## 4. Provider precedence and client read model

`PRIMARY_PROVIDER` configures the primary source (`provider-a` by default, or `provider-b`). For score reads, `MatchService`:

1. Returns the primary provider's stored snapshot if one exists.
2. Otherwise returns the secondary provider's snapshot if one exists.
3. Returns no score when neither provider has supplied one.

Commentary uses the same provider ordering independently: it returns the first provider with stored commentary and never merges two providers' commentary into one list. Score and commentary can therefore have different selected providers if one provider has no data for one of those resources; each response reports its source provider where applicable.

A temporary poll failure does not itself cause failover. The last successfully stored snapshot remains available. This avoids switching sources merely because a single request failed and keeps the selection rule deterministic. Automatic health-based failover and cross-provider reconciliation are outside the assignment scope.

## 5. Transactions, concurrency, and failure recovery

- **Webhook atomicity:** Provider A's delivery ID, snapshot mutation, and commentary mutation commit or roll back together.
- **Duplicate delivery:** A database uniqueness constraint on `(provider, delivery_id)` prevents the same webhook delivery from being applied twice, including when concurrent requests race.
- **Snapshot race protection:** A conditional SQL UPSERT ensures only the newest tuple wins. There is no application-level read/compare/write gap.
- **Commentary correction:** A unique logical-ball key and conditional revision UPSERT ensure that only a higher revision replaces an existing ball.
- **Poll failure:** Each Provider B resource is processed independently. A score endpoint failure does not discard a successful commentary response, and vice versa.
- **Restart:** Match mappings are seeded idempotently; all ingested state is persisted in SQLite and is available after reopening the same database file.
- **Crash around webhook acknowledgement:** If the transaction did not commit, no delivery ID or partial event mutation is retained and the provider can retry. If it committed but the response was lost, retry is detected using the stored delivery ID.

SQLite is configured with foreign keys enabled, WAL journaling, `synchronous=NORMAL`, and a 5-second busy timeout. WAL improves reader/writer coexistence, while SQLite still serializes write transactions. This is suitable for the assignment's single-process workload, not an assertion that SQLite is the right choice for a multi-instance high-write production deployment.

## 6. Caching and performance

There is deliberately **no application cache**. The application serves one seeded match, and the database has indexes for its primary lookup and ordered-commentary paths. Introducing Redis or an in-memory cache would add invalidation and consistency concerns without a meaningful benefit at this scope. SQLite remains the source of truth.

The first likely bottleneck at higher load is SQLite's single-writer model combined with synchronous `better-sqlite3` calls on the Node.js event loop. Large poll responses and repeated full-commentary upserts would also increase write work.

## 7. Evolution for hundreds of concurrent matches and heavier reads

If the service needed to support hundreds of simultaneous matches and substantially more traffic, I would evolve it incrementally:

1. **Database:** Move to PostgreSQL for concurrent writers, stronger operational tooling, and easier multi-instance deployment. Keep unique constraints and conditional UPSERT semantics so correctness does not depend on process-local locks.
2. **Provider polling:** Store provider match subscriptions/configuration in the database and schedule polls per active match. Add bounded concurrency, jitter, request backoff, and per-provider rate limits. For multiple application instances, use a distributed lease or a dedicated polling worker so the same match is not polled redundantly by every instance.
3. **Ingestion boundary:** Keep webhook handling thin. If provider volume requires asynchronous processing, validate and persist a durable inbox/outbox record before acknowledging, then process through a queue with idempotent consumers. Do not acknowledge a push event before its durable handoff is committed.
4. **Read path:** Add pagination for commentary, cache stable match metadata, and consider a short-lived cache for selected live score responses. Invalidate or update cache entries only after the database transaction commits. Use read replicas only if read volume justifies the added replication complexity.
5. **Operations:** Add metrics for poll duration/failure, webhook latency, duplicate deliveries, stale snapshot rejections, DB contention, and ingestion lag. Add retention policies for old delivery records only after defining the provider retry horizon and replay requirements.

These are future scaling options, not dependencies of the current assignment implementation.

## 8. Current scope and trade-offs

The implementation intentionally uses one Node.js process, one SQLite database, one seeded match, deterministic local provider mocks, and configuration-based provider precedence. It does not include authentication, a frontend, a message broker, distributed locks, automatic health-based failover, cross-provider field merging, or deployment infrastructure. These omissions keep the solution focused on the required ingestion, consistency, persistence, and read behavior.
