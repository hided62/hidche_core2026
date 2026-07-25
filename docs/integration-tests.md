# Integration Tests (Initialization Flow)

This document describes the end-to-end integration test that exercises the
gateway, game-api, and game-engine initialization flow.

## Scope

The initialization integration test validates:

- database reset and schema readiness
- bootstrap admin creation
- demo user provisioning (10 accounts)
- scenario install for `che` with `scenario_2` and 1-minute ticks
- deterministic seeding (via env)
- auto admin general creation
- general creation for demo users with constrained city selection
- reserved turn submission (uprising, founding, appointment)
- running three turns and validating founding outcomes

The test runs real Postgres and Redis, and talks to the API servers via tRPC.

## Files

- `tools/integration-tests/test/initialization.test.ts`
- `tools/integration-tests/vitest.config.ts`

## Prerequisites

- Postgres and Redis are running and reachable.
- `.env.ci` is present at the repo root and contains:
    - Postgres and Redis connection settings.
    - `GAME_TOKEN_SECRET`, `KAKAO_REST_KEY`, `KAKAO_REDIRECT_URI`
    - `GATEWAY_BOOTSTRAP_TOKEN`
    - `GATEWAY_API_HOST`, `GATEWAY_API_PORT`, `GAME_API_HOST`, `GAME_API_PORT`
    - `GATEWAY_TRPC_PATH`, `GAME_TRPC_PATH`, `GAME_API_EVENTS_PATH`
    - `PROFILE=che`, `SCENARIO=2`
- `pnpm install` and `pnpm build` have already completed.

## Safety

The test truncates the `public` and `che` schemas and flushes Redis. Use a
dedicated CI/local database and Redis instance.

## Running

Use the root helper script:

```sh
pnpm test:integration
```

Or run the package script directly:

```sh
pnpm --filter @sammo-ts/integration-tests test:integration
```

## Environment Flags

- `INTEGRATION_WORLD_SEED`: injected into world meta as `hiddenSeed` for
  deterministic RNG.
- `INTEGRATION_JOIN_ALLOW_CITY=true`: allows test-only city selection when
  creating generals (still restricted to level 5/6 cities).

These are loaded from `.env.ci` and can be overridden per run.

## Notes

- `auth.bootstrapLocal` only works when no users exist; the test resets the DB
  to satisfy this precondition.
- `profiles.installNow` seeds the scenario and auto-creates the admin general.
- The test runs turn processing via administrator-authorized
  `turnDaemon.run` and validates founding rules at the third turn.
