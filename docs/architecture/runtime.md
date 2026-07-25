# Runtime and Build Profiles

Build outputs should be emitted to `/dist/{profileName}` per profile to keep
deployments predictable. Profiles are server+scenario pairs, and scenario
selection is required because it drives unit sets and DB settings.

## TypeScript Toolchain

The rewrite workspace uses exactly TypeScript `6.0.2`. TypeScript 7 is not a
supported build or validation environment until the compiler/tooling APIs used
by this repository and the dependent toolchain are available and compatible.
Package-local TypeScript 5 or 7 overrides are not allowed in `app/*`,
`packages/*`, or `tools/*`. The legacy runtime under `legacy/` is maintained
separately and is outside this rule.

The rationale, scope, and TypeScript 7 upgrade gate are defined in
[`typescript-version.md`](typescript-version.md).

## Database Schemas (Gateway vs Game)

Gateway uses a shared schema (default `public`) for login/profile state, while
each game profile runs against its own schema. This keeps gateway data stable
and allows profile-scoped game data resets.

- Gateway schema: `GATEWAY_DB_SCHEMA` (default `public`)
- Game schema: `PROFILE` value (e.g., `hwe`, `che`)
- Optional override for gateway DB URL: `GATEWAY_DATABASE_URL`

## Suggested Build Pattern

- Wrapper script under `tools/build-scripts`
- `pnpm build:server --profile che --scenario default`
- CI-friendly: `PROFILE=che SCENARIO=default pnpm build:server`
- Build tooling: use `tsdown` for backend/libs, and Vite for frontend apps.

## Deterministic RNG Policy

- Gameplay randomness must be reproducible from a deterministic seed
- Prefer `legacy/hwe/ts/util/LiteHashDRBG.ts` and `legacy/hwe/ts/util/RNG.ts`
- Seed composition should include hidden base seed plus action context

## Gateway Orchestration (Single Host Draft)

Gateway API is the single source of truth for profile state and reconciles
PM2-managed processes on boot and on a short interval. The orchestrator runs
as a separate process (`GATEWAY_ROLE=orchestrator`). The DB owns the desired
state; PM2 is treated as the actuator. The runtime state is grouped so that
`game-api` + `turn-daemon` are either on together or off together.

### DB-Owned Profile State

Profiles are tracked by `profileName` (= `${profile}:${scenario}`).
Gateway loads the profile table on boot, then reconciles PM2 to match.

- `예약됨` (RESERVED): preopen/open timestamps are set; processes off.
- `가오픈` (PREOPEN): build done; API+daemon on, daemon paused.
- `가동중` (RUNNING): both `game-api` and `turn-daemon` should be on.
- `정지됨` (STOPPED): processes off; may be resumed later.
- `정지(오류)` (PAUSED): fatal error; daemon paused but process remains on.
- `천하통일` (COMPLETED): game finished; API on, daemon paused.
- `비활성화` (DISABLED): excluded from orchestration; start forbidden.

### Boot Reconciliation

1. Load profile rows from DB.
2. List PM2 processes and map `profileName -> running state`.
3. For each profile:
    - If desired `RUNNING/PREOPEN/PAUSED/COMPLETED` and any process is missing, start.
    - If desired `RESERVED/STOPPED/DISABLED` and any process is running, stop both.
4. Persist errors to DB for audit.

### Internal Scheduler (Gateway Cron)

Gateway runs a lightweight cron loop (setInterval) that:

- When `RESERVED` and `preopenAt <= now`, queue a build for the reserved commit.
- When build succeeds, status becomes `PREOPEN` (daemon paused).
- When `openAt <= now`, status becomes `RUNNING` and daemon resumes.
- Optionally drains a build queue (see build workflow).

### Build Workflow (Admin)

- Admin triggers a build request for a profile.
- Gateway queues a build job with `(profileName, commitSha)` and prepares a
  per-commit workspace (`/.worktrees/{commitSha}` by default).
- Workspace is backed by `git worktree` and is reused across builds for the same commit.
- Each workspace stores `lastUsedAt` in DB so cleanup can remove stale worktrees.
- Cleanup is invoked manually by admin API and removes worktrees unused for 6+ months.
- Build runs `pnpm install` when workspace is created, then executes
  the common, infra, and logic dependency builds before
  `pnpm --filter @sammo-ts/game-api build` and
  `pnpm --filter @sammo-ts/game-engine build`, then marks build success/failure.
- On success, status moves to `PREOPEN` for reserved builds or stays unchanged for manual builds.
- PM2 starts API/daemon from the profile row's `buildWorkspace`, so profiles
  pinned to different commits execute the artifacts from their own detached
  worktrees. A profile without `buildWorkspace` intentionally falls back to the
  main workspace; this is the `hwe`/main compatibility path.

## Current Implementation Status

- Turn daemon lifecycle + in-memory state live in `app/game-engine` with DB flush hooks.
- 모든 tRPC mutation은 PostgreSQL `input_event` 경계에서 request ID와 처리
  상태를 기록한다.
- 월드 mutation과 daemon control은 PostgreSQL inbox로 전달된다. Redis는
  더 이상 이 명령들의 영속 큐가 아니며 realtime/battle-sim 전송에만 남아
  있다.
- API가 직접 변경하는 예약 턴·메시지 등의 DB 쓰기는 API input event 완료와
  같은 transaction에서 commit된다.
- 엔진 명령은 도메인 DB 쓰기, in-memory world flush, 예약 턴, 로그, 결과
  저장과 inbox 완료를 하나의 transaction으로 commit한다.

## Turn Daemon and API Server Behavior (Outline)

- Turn daemon responsibilities: scheduling, turn resolution, state persistence
- API server responsibilities: query/command intake, validation, response shaping
- Concurrency model between daemon and API server
- Durable command channel: PostgreSQL `input_event`
- Client updates: SSE between API server and frontend where appropriate

## Durable Input Event Split

PostgreSQL is the source of truth for accepted input. Redis pub/sub remains a
best-effort notification/fan-out path and must not decide whether a gameplay
mutation was committed.

### Recommended Split

- PostgreSQL `input_event`:
    - API mutation acceptance, idempotency, attempts and audit state.
    - API server -> daemon mutation/control payloads and durable results.
    - `FOR UPDATE SKIP LOCKED` claim plus worker lease for concurrent consumers.
    - engine result and gameplay state commit in the same transaction.
- Redis pub/sub:
    - Daemon -> API server: low-stakes live update signals (run started/ended).
    - API server -> frontend: SSE fan-out triggered by pub/sub updates.
    - Do not use pub/sub for data that must be replayed or audited.

### Operational Notes

- 각 profile은 별도 game DB schema/connection을 사용한다.
- HTTP `Idempotency-Key`(없으면 Fastify request ID)와 tRPC path를 합친 값이
  API input event key다.
- 처리 중 lease가 만료된 engine event만 `PENDING`으로 회수한다.
- 완료 event 보존/정리 기간과 `FAILED` 재처리 운영 정책은 별도로 정해야 한다.

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

현재 구현은 control 명령과 registry의 모든 world mutation을 같은 DB queue로
읽어 턴 사이에 처리한다.

### Daemon Control Contract (Draft)

API server commands are inserted into PostgreSQL `input_event`; the daemon
stores status/results on the same row. An in-process queue remains available
for tests and internal signals.

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

- The API server validates commands and records every tRPC mutation in
  PostgreSQL.
- After a request is processed, the API server returns the result to clients.
- Read-only queries may access the DBMS directly.
- The API server may use SSE to stream live updates to the frontend.

### Queue and Rate Limits

- Engine-owned requests are delivered through the PostgreSQL inbox.
- Per-user pending limits and event retention remain operational follow-up
  work; idempotency and exclusive claim are implemented.

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
