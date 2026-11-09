# Live Sports Match Data Aggregator

A small Node.js backend that ingests live cricket match data from two independent providers, stores each provider's updates, and exposes a unified set of match APIs.

The application demonstrates **push ingestion**, **poll-based ingestion**, **idempotency**, **out-of-order event handling**, **revision-based corrections**, and **deterministic provider precedence**. It intentionally does not calculate cricket scores from commentary; score snapshots are accepted as supplied by the providers.

## 1. Technology

- **Runtime:** Node.js 20 or newer
- **Language:** TypeScript
- **HTTP framework:** Express 5
- **Database:** SQLite using `better-sqlite3`
- **Validation:** Zod
- **Logging:** Pino
- **Tests:** Vitest and Supertest

No external API credentials are required. Both providers are represented by deterministic local mocks/generators.

## 2. Architecture at a glance

```text
Provider A (push)                         Provider B (poll)
       |                                        ^
       | POST /webhooks/provider-a              | GET score + commentary
       v                                        |
Provider A Controller                  Provider B Poller
       |                                        |
       +-------------------+--------------------+
                           v
                  Aggregation Service
                           |
                 SQLite provider tables
                           |
                      Match Service
                           |
                  Client-facing REST APIs
```

Both providers use the same aggregation rules, but their snapshots and commentary are stored independently. The read layer selects one provider according to the configured precedence; it does not combine score fields or commentary from different providers.

## 3. Prerequisites

Install:

- Node.js **20+**
- npm (comes with Node.js)

`better-sqlite3` is a native Node.js module. On platforms where npm cannot download a prebuilt binary, install the platform's native build tools (for example, Python, `make`, and a C/C++ compiler) before running `npm ci`.

## 4. Local setup

From the project root:

```bash
npm ci
```

Create a local environment file.

**macOS/Linux/WSL:**

```bash
cp .env.example .env
```

**Windows PowerShell:**

```powershell
Copy-Item .env.example .env
```

The default `.env.example` values are sufficient for a local run. The application creates the SQLite database directory and applies the schema automatically when it starts.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Aggregator HTTP port |
| `NODE_ENV` | `development` | Runtime environment |
| `DB_PATH` | `data/matches.sqlite` | SQLite database file path; `:memory:` is used by tests |
| `PROVIDER_A_WEBHOOK_URL` | `http://localhost:3000/webhooks/provider-a` | Target URL used by the Provider A generator script |
| `PROVIDER_B_BASE_URL` | unset in schema; set in `.env.example` to `http://localhost:4001` | Base URL polled by the Provider B poller; polling is disabled when absent |
| `POLL_INTERVAL_MS` | `5000` | Provider B polling interval in milliseconds |
| `PRIMARY_PROVIDER` | `provider-a` | Read precedence: `provider-a` or `provider-b` |
| `MOCK_PROVIDER_B_PORT` | `4001` | Port used by the standalone Provider B mock script |

Do not commit `.env`, database files, `node_modules`, or generated `dist` output. `.gitignore` already excludes these paths.

## 5. Run the application and provider mocks

Open separate terminals from the project root.

**Terminal 1 — start the Provider B mock:**

```bash
npm run mock:provider-b
```

The mock listens on port `4001` by default and exposes:

- `GET http://localhost:4001/provider/matches/b-match-1001/score`
- `GET http://localhost:4001/provider/matches/b-match-1001/commentary`

**Terminal 2 — start the aggregator:**

```bash
npm run dev
```

The aggregator listens on port `3000` by default. When `PROVIDER_B_BASE_URL` is configured, its poller starts after the HTTP server starts, performs an immediate poll, and then polls at `POLL_INTERVAL_MS` intervals.

**Terminal 3 — send Provider A's deterministic push events:**

```bash
npm run mock:provider-a
```

The generator sends a scripted set of webhook events to `PROVIDER_A_WEBHOOK_URL`. It demonstrates normal delivery, a repeated `deliveryId`, out-of-order commentary, a delayed older snapshot, commentary and snapshot corrections, and snapshot-only/commentary-only events. Each event is logged with its HTTP response.

> Start the Provider B mock before the aggregator if you want to avoid initial connection-refused log entries from the first poll.

## 6. Docker setup (preferred)

Docker Compose starts the aggregator and the mock Provider B service on the same network. The SQLite database is persisted in a named volume.

```bash
docker compose up --build
```

The aggregator is available at `http://localhost:3000`. To send the deterministic Provider A events from a one-off container:

```bash
docker compose run --rm app npm run mock:provider-a
```

To stop the services:

```bash
docker compose down
```

The named `fancode-data` volume is retained by default. To remove the persisted database as well, run `docker compose down -v`.

## 7. API reference

The seeded internal match ID is `match-1001`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/matches` | List known matches and their preferred-provider score summary, if available |
| `GET` | `/matches/:id` | Match details and preferred-provider score summary |
| `GET` | `/matches/:id/score` | Preferred-provider score snapshot |
| `GET` | `/matches/:id/commentary` | Commentary from the preferred available provider, ordered by sequence |
| `POST` | `/webhooks/provider-a` | Receive a Provider A push event |

The match read endpoints return JSON in a `data` envelope. Unknown internal match IDs return `404`. Commentary returns an empty list if no provider has commentary yet. The score endpoint returns `404` if the match exists but no provider has supplied a score snapshot.

### Example requests

```bash
curl http://localhost:3000/matches
curl http://localhost:3000/matches/match-1001
curl http://localhost:3000/matches/match-1001/score
curl http://localhost:3000/matches/match-1001/commentary
```

### Provider A webhook example

```bash
curl -X POST http://localhost:3000/webhooks/provider-a \
  -H 'Content-Type: application/json' \
  -d '{
    "provider": "provider-a",
    "deliveryId": "d-manual-001",
    "occurredAt": "2026-10-22T14:00:00.000Z",
    "providerMatchId": "a-match-1001",
    "snapshot": {
      "sequence": 1,
      "revision": 1,
      "status": "live",
      "innings": 1,
      "runs": 4,
      "wickets": 0,
      "overs": "0.1"
    },
    "commentary": {
      "ballId": "inn1-0.1",
      "sequence": 1,
      "revision": 1,
      "innings": 1,
      "over": 0,
      "ball": 1,
      "text": "Pulled away to the boundary for four."
    }
  }'
```

A successful first delivery returns `200` with `duplicate: false`. Re-sending the same `provider` and `deliveryId` returns `200` with `duplicate: true` and does not reapply the payload.

## 8. Data and ordering rules

- The seeded internal match ID is `match-1001`.
- Provider A's external match ID is `a-match-1001`.
- Provider B's external match ID is `b-match-1001`.
- Snapshot precedence is evaluated **within one provider only** using `(sequence, revision)`. A higher sequence wins; when sequences are equal, a higher revision wins. An equal or lower tuple is ignored.
- Commentary identity is `(provider, match, ballId)`. A higher revision updates the existing logical ball; an equal or lower revision is ignored.
- Commentary is read in ascending `sequence` order, with `ballId` as a deterministic tie-breaker.
- Provider timestamps are not used to decide which snapshot or commentary revision wins.
- `overs` is represented and returned as a string; runs, wickets, innings, and overs are not calculated from commentary.

## 9. Tests

Run the automated test suite:

```bash
npm test
```

The test files are under `tests/unit` and `tests/integration`. They cover:

- Snapshot tuple comparison and revision ordering.
- Commentary identity, correction, deduplication, and sequence ordering.
- Provider A ordered ingestion, duplicate delivery IDs, delayed snapshots, late commentary, and corrections.
- Provider B repeated polls, stale score responses, and provider errors.
- Provider precedence and no cross-provider commentary mixing.
- Concurrent ingestion and restart persistence.
- Client API behavior for unknown matches and empty commentary.

Tests use an in-memory SQLite database and do not require either mock provider to be running.

## 10. Database and persistence

The application creates the database at `DB_PATH`, enables SQLite foreign keys, WAL mode, `synchronous=NORMAL`, and a 5-second busy timeout, then applies the SQL migration. The match and external provider-ID mappings are seeded idempotently at startup. Persisted snapshots, commentary, and processed Provider A delivery IDs survive application restarts as long as the same database file is retained.

For a clean local reset, stop the application and remove the database file specified by `DB_PATH`. The next startup recreates the schema and seed records.

## 11. Scope and assumptions

- This is a single-process assignment implementation for one seeded match, not a multi-instance production deployment.
- No authentication, frontend, cloud services, message broker, or external provider credentials are required.
- Provider A is simulated by a deterministic event generator; Provider B is simulated by a deterministic HTTP mock.
- Provider B returns the full commentary list on every poll; the aggregator makes repeated polls idempotent through the commentary upsert key and revision rule.
- Provider precedence is configuration-based. A temporary provider failure does not erase its last successfully stored data; automatic health-based failover is not implemented.
- There is no cache. For this assignment's single-match workload, SQLite is the source of truth and direct indexed reads are sufficient.
- The application does not infer or calculate cricket score values from ball commentary.

## 12. Useful commands

```bash
npm run dev             # Start the aggregator in development mode
npm run build           # Compile TypeScript into dist/
npm start               # Start the compiled application
npm test                # Run automated tests
npm run test:watch      # Run tests in watch mode
npm run db:migrate      # Initialize/apply the database schema
npm run db:seed         # Seed the internal match and provider mappings
npm run mock:provider-a # Send Provider A's scripted webhook events
npm run mock:provider-b # Start the Provider B mock HTTP service
```
