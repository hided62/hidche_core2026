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
