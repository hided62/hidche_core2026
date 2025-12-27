# Runtime and Build Profiles

Build outputs should be emitted to `/dist/{profileName}` per profile to keep
deployments predictable. Profiles are server+scenario pairs, and scenario
selection is required because it drives unit sets and DB settings.

## Suggested Build Pattern

- Wrapper script under `tools/build-scripts`
- `pnpm build:server --profile che --scenario default`
- CI-friendly: `PROFILE=che SCENARIO=default pnpm build:server`

## Deterministic RNG Policy

- Gameplay randomness must be reproducible from a deterministic seed
- Prefer `legacy/hwe/ts/util/LiteHashDRBG.ts` and `legacy/hwe/ts/util/RNG.ts`
- Seed composition should include hidden base seed plus action context

## Turn Daemon and API Server Behavior (Outline)

- Turn daemon responsibilities: scheduling, turn resolution, state persistence
- API server responsibilities: query/command intake, validation, response shaping
- Concurrency model between daemon and API server
- Communication channel: Redis Stream or Redis pub/sub
- Client updates: SSE between API server and frontend where appropriate

## Redis Communication Recommendation (Draft)

Use Redis Streams for daemon control and mutation requests, and Redis pub/sub
for transient fan-out events. Streams provide durability, backpressure, and
replay while pub/sub keeps live updates simple and low-latency.

### Recommended Split

- Redis Streams:
  - API server -> daemon: mutation requests, turn-run commands.
  - Daemon -> API server: run status events, job results, error reports.
  - Use consumer groups for daemon workers and API server listeners.
  - Require `requestId` for correlation and idempotency.
  - Ack on success; move failed items to a dead-letter stream after retry.
- Redis pub/sub:
  - Daemon -> API server: low-stakes live update signals (run started/ended).
  - API server -> frontend: SSE fan-out triggered by pub/sub updates.
  - Do not use pub/sub for data that must be replayed or audited.

### Operational Notes

- Stream keys should be namespaced per server+scenario profile.
- Use bounded stream length (`MAXLEN`) to cap storage.
- API server should guard against duplicate processing by `requestId`.
- When the daemon is busy, API queues new mutations to stream and responds
  with an accepted status to clients.

Detailed lifecycle and control flow are defined in
`docs/architecture/turn-daemon-lifecycle.md`.

## Authentication and Session Management (Draft)

Login uses Kakao OAuth as the primary identity provider because it leverages
Korean real-name verification and helps prevent multi-account abuse. The system
also supports local ID/password login for users who cannot use Kakao.

### Login Options

- Kakao login button (OAuth flow via Gateway).
- Local login with ID/password (managed by Gateway).
- Passkey is a possible future option; define later if required.
- Auto-login should be supported when an active session exists.

### Session and SSO-Like Behavior

- Gateway handles login and owns primary sessions in Redis.
- Game servers may run different branches; treat Gateway as a central SSO
  authority that issues session tokens for each server+scenario profile.
- API servers validate tokens against Redis and accept sessions issued by
  Gateway without re-authentication.
- Session tokens should be scoped by server+scenario profile to avoid cross-server leaks.

### Operational Notes

- Prefer HTTP-only secure cookies for session tokens where possible.
- Provide a logout flow that revokes tokens in Redis.
- Track last-login and session metadata for audit and abuse detection.

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

### Daemon Control Contract (Draft)

API server commands are delivered to the daemon over the control channel
(Redis Stream or in-process). The daemon replies with status and run events.

```ts
export type RunReason = 'schedule' | 'manual' | 'poke';

export type DaemonCommand =
    | { type: 'run'; reason: RunReason; targetTime?: string; budget?: TurnRunBudget }
    | { type: 'pause'; reason?: string }
    | { type: 'resume'; reason?: string }
    | { type: 'getStatus'; requestId: string };

export type DaemonEvent =
    | { type: 'status'; requestId?: string; status: TurnDaemonStatus }
    | { type: 'runStarted'; at: string; reason: RunReason }
    | { type: 'runCompleted'; at: string; result: TurnRunResult }
    | { type: 'runFailed'; at: string; error: string };
```

### API Server Flow

- The API server validates queries/commands and writes them to Redis Streams
  or Redis pub/sub.
- After a request is processed, the API server returns the result to clients.
- Read-only queries may access the DBMS directly.
- The API server may use SSE to stream live updates to the frontend.

### Queue and Rate Limits

- API server requests are delivered to the daemon via Redis Streams or
  Redis pub/sub.
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
