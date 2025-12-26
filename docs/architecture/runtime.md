# Runtime and Build Profiles

Build outputs should be emitted to `/dist/{serverName}` per profile to keep
deployments predictable.

## Suggested Build Pattern

- Wrapper script under `tools/build-scripts`
- `pnpm build:server --profile che`
- CI-friendly: `PROFILE=che pnpm build:server`

## Deterministic RNG Policy

- Gameplay randomness must be reproducible from a deterministic seed
- Prefer `legacy/hwe/ts/util/LiteHashDRBG.ts` and `legacy/hwe/ts/util/RNG.ts`
- Seed composition should include hidden base seed plus action context

## Turn Daemon and API Server Behavior (Outline)

- Turn daemon responsibilities: scheduling, turn resolution, state persistence
- API server responsibilities: query/command intake, validation, response shaping
- Concurrency model between daemon and API server

## Engine Runtime Flow (Draft)

### Turn Daemon Loop

- The turn daemon runs as a single-threaded loop.
- The daemon engine uses in-memory state as the primary working set.
- The daemon waits on two conditions during the event loop.
  - Query/command requests from the external API server.
  - The scheduled start time of the next turn.
- External requests are processed until the next turn start time is reached.
  - If no requests arrive, the daemon waits until the next turn start time.
  - When the next turn start time arrives, the daemon starts turn processing
    immediately even if requests remain queued.
- While the daemon is resolving a turn, the API server queues incoming requests.

### API Server Flow

- The API server validates queries/commands and writes them to Redis Streams.
- After a request is processed, the API server returns the result to clients.
- Read-only queries may access the DBMS directly.

### Queue and Rate Limits

- API server requests are delivered to the daemon via Redis Streams.
- Redis Stream mutation requests are rate-limited per user.
  - Each user can have up to 30 pending mutation requests.
  - Additional requests are rejected once the limit is exceeded.

### In-Memory and DBMS Flush

- The daemon processes actions against in-memory state by default.
- DBMS writes are flushed in bulk after turn processing completes.
- Frequently changing "next-turn intent" data is stored separately.
  - The API server persists this data in the DBMS.
  - The daemon loads only this data when the next turn begins.

## Turn Daemon vs API Query Priority (Outline)

- Expected priority order under load
- Rules for preemption or deferral
- Handling of write-heavy operations during turn resolution

## In-Memory Processing and DBMS Flush (Outline)

- When in-memory state is authoritative
- Flush checkpoints and transactional boundaries
- Recovery strategy after crash during flush

## Testing and Observability (Outline)

- Metrics and logs required to validate scheduling and flush behavior
- Suggested test scenarios for concurrency and consistency

## Game Logic Testing (Draft)

### Deterministic Inputs

- RNG seed composition (hidden server seed, turn info, general info).
- Scenario selection and scenario data.
- Trigger set inputs: nation, general, and city state.
- Game time and tick schedule.

### Recommended Unit Test Flow

- Prepare a deterministic test fixture (mock DB or in-memory state snapshot).
- Execute game logic unit tests with fixed inputs and seeds.
- Compare expected outputs against the pre-flush change set that would be
  written to the DBMS.

### Notes

- Deterministic RNG makes output comparison stable and repeatable.
- Prefer snapshotting inputs/outputs so regressions are easy to track.
