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
   - Call `turnDaemon.status` over tRPC and expect a non-null status.
   - Send a mutation command that expects a result (e.g., `troop.join`) and
     verify `commandResult` is received.

6) **Verify realtime events**
   - Trigger a run via `turnDaemon.run`.
   - Subscribe to `sammo:${profileName}:realtime:events` and wait for
     `turnCompleted`.

7) **Cleanup**
   - Stop orchestrator, then `pm2 delete` the processes by name:
     `sammo:${profileName}:game-api` and `sammo:${profileName}:turn-daemon`.
   - Flush Redis and drop the test schemas.

## What to Check

Mandatory checks:

- PM2 reports both processes as online.
- `turnDaemon.status` responds within the timeout.
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
