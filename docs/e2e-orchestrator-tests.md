# PM2-Orchestrated E2E Test (Gateway Orchestrator)

This document describes how to run a full end-to-end test using the gateway
orchestrator (PM2) so that `game-api` and `game-engine` run as real processes
and communicate over Redis.

## Goal

Validate the full process boundary:

- gateway orchestrator starts/stops `game-api` and `turn-daemon` via PM2
- `game-api` talks to the daemon over Redis streams
- daemon publishes realtime events over Redis pub/sub
- optional mutation commands flow from API to engine and back

## Where to Implement

Use the existing integration test package and add a PM2-backed test.

- Test file: `tools/integration-tests/test/orchestrator.e2e.test.ts`
- Test helpers: `tools/integration-tests/src/orchestratorHarness.ts`
- Reuse existing integration setup in `docs/integration-tests.md`

Core integration points:

- Orchestrator entrypoint: `app/gateway-api/src/orchestrator/orchestratorServer.ts`
- PM2 manager: `app/gateway-api/src/orchestrator/pm2ProcessManager.ts`
- Process names: `app/gateway-api/src/orchestrator/gatewayOrchestrator.ts:244`
- Redis stream keys: `app/game-api/src/daemon/streamKeys.ts`, `app/game-engine/src/lifecycle/redisCommandStream.ts`
- Turn daemon status endpoint: `app/game-api/src/router/turnDaemon/index.ts`

## Prerequisites

- PM2 is installed and available on PATH.
- `pnpm --filter @sammo-ts/game-api build`
- `pnpm --filter @sammo-ts/game-engine build`
- `pnpm --filter @sammo-ts/gateway-api build` (to run orchestrator in dist)
- Postgres and Redis are running (use a dedicated DB/schema and Redis DB).

Minimum environment variables for the test:

- `DATABASE_URL` or `POSTGRES_*` (both `game-api` and `game-engine` rely on this)
- `GATEWAY_DB_SCHEMA` (gateway profile DB schema)
- `REDIS_URL`
- `GAME_TOKEN_SECRET`
- `GATEWAY_REDIS_PREFIX` (optional but recommended to isolate keys)
- `GATEWAY_WORKSPACE_ROOT` (workspace root with built `dist/`)
- `GATEWAY_WORKTREE_ROOT` (worktree root for builds; can be temp)
- `GATEWAY_TRPC_PATH` (e.g. `/gateway/api/trpc`)
- `GAME_TRPC_PATH` (e.g. `/che/api/trpc`)
- `GAME_API_EVENTS_PATH` (e.g. `/che/api/events`)

For profile alignment:

- `PROFILE` and `SCENARIO` for game server processes
- `TURN_PROFILE_NAME` should match `${PROFILE}:${SCENARIO}`

## Procedure

1) **Reset state**
   - Truncate the game schema and gateway schema.
   - Flush Redis (or use a dedicated Redis DB index).

2) **Seed the game DB**
   - Use `seedProfileDatabase` to seed a scenario and create an admin general.
   - Use a fixed `INTEGRATION_WORLD_SEED` to keep deterministic RNG.

3) **Create/Update the gateway profile record**
   - Upsert a profile with status `RUNNING` (or `PREOPEN`) and a known `apiPort`.
   - Ensure `profileName` is `${profile}:${scenario}`.

4) **Start the orchestrator**
   - Run `app/gateway-api/dist/index.js` with `GATEWAY_ROLE=orchestrator`.
   - Or instantiate `GatewayOrchestrator` directly and call `start()`.
   - Wait for PM2 to report the processes as `online`.

5) **Verify API <-> daemon**
   - Exchange a gateway session carrying `superuser`, `admin`, or
     `admin.profiles.manage[:<profile>]` for a game access token.
   - Call `turnDaemon.status` with that administrator token and expect a
     non-null status.
   - Send a mutation command that expects a result (e.g., `troop.join`) and
     verify `commandResult` is received.

6) **Verify realtime events**
   - Trigger a run via `turnDaemon.run` with the administrator token.
   - Subscribe to `sammo:${profileName}:realtime:events` and wait for
     `turnCompleted`.

7) **Cleanup**
   - Stop orchestrator, then `pm2 delete` the processes by name:
     `sammo:${profileName}:game-api` and `sammo:${profileName}:turn-daemon`.
   - Flush Redis and drop the test schemas.

## What to Check

Mandatory checks:

- PM2 reports both processes as online.
- Authenticated profile administration is required for every
  `turnDaemon.run/pause/resume/status` call.
- `turnDaemon.status` responds within the timeout for the administrator token.
- A command with `commandResult` returns a success response.
- A `turnCompleted` realtime event is observed after a `run` command.

Optional checks:

- `worldState.lastTurnTime` advances after a run.
- A mutation command changes DB state (e.g., troop join/exit).

## Notes

- `turnDaemon.run` is fire-and-forget; rely on status or realtime events for
  confirmation.
- PM2 is global; use unique `profileName` per test run to avoid collisions.
- Orchestrator starts binaries from `dist/` under `GATEWAY_WORKSPACE_ROOT`.
  If build artifacts are missing, PM2 will start and immediately exit.

## HWE GUI lifecycle

`app/gateway-frontend/e2e/hwe-lifecycle.spec.ts` verifies the operational
browser flow with one administrator and two independent user contexts:

1. The administrator logs in, selects `hwe:2`, loads scenario 2 from a fixed
   commit, requests a reset, and waits for that exact operation to succeed.
2. The administrator returns to the gateway main page and sees the open HWE
   action.
3. Each user logs in with a separate Chromium context, sees the same open HWE
   row, creates a general, and reaches the HWE main dashboard without an error.

The test uses an ignored secret directory. It reads `admin_password`,
`user_a_password`, and `user_b_password` from
`SAMMO_LIFECYCLE_SECRET_ROOT`; passwords must not be passed on the command
line. `SAMMO_LIFECYCLE_SOURCE_COMMIT` must be a full commit SHA.

Build the gateway frontend with the public prefix contract before starting its
preview server:

```bash
VITE_APP_BASE_PATH=/gateway \
VITE_GATEWAY_API_URL=/gateway/api/trpc \
VITE_GAME_API_URL_TEMPLATE='/{profile}/api/trpc' \
VITE_GAME_WEB_URL_TEMPLATE='/{profile}/' \
pnpm --filter @sammo-ts/gateway-frontend build
```

Build the HWE frontend with `VITE_APP_BASE_PATH=/hwe`,
`VITE_GAME_API_URL=/hwe/api/trpc`, and
`VITE_GAME_SSE_URL=/hwe/api/events`. Start the isolated gateway API,
orchestrator, both previews, Postgres, and Redis, then run:

```bash
SAMMO_LIFECYCLE_SECRET_ROOT=/path/to/ignored/secrets \
SAMMO_LIFECYCLE_SOURCE_COMMIT="$(git rev-parse HEAD)" \
pnpm --filter @sammo-ts/gateway-frontend test:e2e:hwe-lifecycle
```

The Playwright web server is a local prefix-preserving proxy on port `15140`.
It mirrors the Caddy route contract while keeping all navigation on one
origin. Passing the test means the actual reset/build/seed/PM2 process path and
both user creation flows completed; it is not a mocked API test.
