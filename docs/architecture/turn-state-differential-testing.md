# Turn command state differential testing

## Scope

This harness compares observable state changes produced by:

- general reserved commands;
- nation reserved commands;
- live `che_출병`, including persisted battle aftermath.

It complements the battle simulator differential suite. The simulator suite
compares phase order, RNG and battle numbers. This harness compares the command
boundary, logs, queues, diplomacy and final database state.

## Execution flow

```text
canonical case
  ├─ ref ng_compare command runner
  │    ├─ clone root/HWE MariaDB
  │    ├─ execute legacy GeneralCommand or NationCommand
  │    └─ before/after snapshot + command RNG trace
  └─ core2026 execution boundary
       ├─ construct the in-memory turn world from the prepared ref snapshot
       ├─ execute the real reserved-turn handler
       └─ before/after snapshot + command RNG trace

ref delta ─┐
           ├─ exact semantic path comparison
core delta ┘
```

The comparison uses entity IDs rather than physical row order. Numeric leaves
are compared as `after - before`, so a fixture may use different harmless
starting balances while still requiring the same effect. Insertions, deletions
and non-numeric changes retain explicit before/after values.

Logs and messages are sequence-sensitive and are therefore paired by observed
order rather than database primary key. Their physical IDs can be ignored
without losing ordering checks. Legacy `*ID` command argument keys are
normalized to the core `*Id` spelling before command identity comparison.

## Components

- Ref `ng_compare`
    - `hwe/compare/turn_state_snapshot.php`: read-only canonical projection.
    - `hwe/compare/turn_command_trace.php`: guarded CLI action runner.
- Workspace reference stack
    - `scripts/run-turn-differential-case.sh`: clones both MariaDB databases,
      injects temporary DB configuration, runs one case and deletes only
      validated `sammo_td_*` databases.
- Core integration tools
    - `canonical.ts`: shared snapshot and trace contracts.
    - `databaseSnapshot.ts`: PostgreSQL projection.
    - `coreCommandTrace.ts`: real in-memory reserved-turn execution and
      canonical projection.
    - `trace.ts`: before/execute/after capture boundary.
    - `compare.ts`: exact snapshot and delta comparison.
    - `turnCommandGeneralMatrix.integration.test.ts`: 54 successful general
      command paths. Together with the live sortie fixture, this exercises a
      completed success path for every one of the 55 general command keys.
      The matrix includes the four-call `전투태세` path, lifecycle and
      appointment commands, troop assembly, rebellion and all three founding
      variants.
    - `turnCommandNationMatrix.integration.test.ts`: 26 successful nation
      command paths, including all nine unit-research commands.
    - `turnCommandCoreReference.integration.test.ts`: declaration and live
      sortie fixtures.

The ref runner refuses mutation unless `TURN_DIFFERENTIAL_ENABLED=1` is present.
The wrapper injects it only into the disposable tool container. Direct
execution against the reference database is not a supported workflow.

Two committed cases exercise the guarded runner end to end:

- `nation-declaration.json`: chief nation command, directed diplomacy
  `state/term` changes and national messages.
- `live-sortie-conquest.json`: real `che_출병 -> processWar`, city capture,
  defeated-general neutralization and last-city nation collapse.

Each case may include a structured `setup` object for `world`, `nations`,
`cities`, `generals`, `troops` and `diplomacy`. The runner accepts only
explicitly mapped fields; it does not accept SQL. Founding fixtures may pin
`initYear`/`initMonth` and an ordered random-founding city candidate set so
both maps expose the same RNG domain. Setup and command mutation happen only
inside the cloned `sammo_td_*` databases.

## Case request

```json
{
    "kind": "general",
    "actorGeneralId": 101,
    "action": "che_출병",
    "args": { "destCityID": 12 },
    "observe": {
        "generalIds": [101, 201],
        "cityIds": [11, 12],
        "nationIds": [1, 2],
        "logAfterId": 0,
        "messageAfterId": 0
    }
}
```

Legacy argument spelling is retained at the ref boundary (`destCityID`,
`destNationID`). The core execution request uses the core spelling
(`destCityId`, `destNationId`), while the trace's semantic entity IDs remain
the same.

Run a ref case:

```sh
cd docker_compose_files/reference
./scripts/run-turn-differential-case.sh \
  fixtures/turn-differential/nation-declaration.json \
  > /tmp/ref-trace.json
```

Capture the core side by wrapping the real reserved-turn or daemon execution
with `captureCoreDatabaseTurnTrace()`. Save the returned JSON, then compare:

```sh
TURN_REFERENCE_TRACE=/tmp/ref-trace.json \
TURN_CORE_TRACE=/tmp/core-trace.json \
pnpm --filter @sammo-ts/integration-tests test:integration \
  turnTraceFiles.integration.test.ts
```

## Canonical coverage

Snapshots currently include:

- world year/month, tick term, last turn time and unification state;
- selected general numeric state, location, nation, troop, equipment metadata,
  last turn and lifecycle counters;
- selected city ownership and all domestic/defence values;
- selected nation resources, type, capital, technology, cached power/counts;
- directed diplomacy state, term and death flag;
- general and nation reserved queues;
- action/history/battle logs;
- legacy messages and log/message watermarks.

Core2026 has no physical legacy `message` table, so its message projection is
empty. Message-equivalent effects must currently be compared through core log
effects or a command-specific projection. The saved-trace comparison explicitly
ignores the `messages` subtree for this reason; this is a documented schema
boundary, not a claim that message delivery is equal.

For live `che_출병`, use both suites:

1. `battleDifferential.test.ts` for internal war RNG/event/numeric parity.
2. Turn command traces for route choice RNG, costs, general/city/nation changes,
   queues, logs, conquest and nation deletion.

## Test trust boundary

Comparator unit tests prove path identity, order independence, numeric delta
handling and deletion detection. Adapter integration tests prove that both
actual databases can produce the canonical form. They do not by themselves
claim that all 55 general and 38 nation commands match.

Compatibility is established per case only when:

1. both engines executed the requested action rather than a fallback;
2. RNG operations and results match;
3. the semantic delta comparison is empty;
4. live sortie also passes the battle trace comparison;
5. any ignored path is documented in the case evidence.

As of 2026-07-26, 54 general matrix cases, 26 nation matrix cases, declaration
and live sortie pass this boundary. Live sortie is the remaining general
command key and covers battle entry, conquest, defeated-general neutralization
and last-city nation collapse. Thus all 55 general command keys have a
completed success-path comparison. This is 82 executable comparison cases;
it is not yet a claim that failure/boundary paths or all 38 nation commands
have been dynamically compared.

The fixture runner also reports whether the requested legacy command reached
its completed execution path. For multi-turn commands this is derived from the
pre-execution `LastTurn`, because commands such as `전투태세` reset their result
term to `1` on the completion call. `등용수락` and the founding commands have
explicit state-based completion checks because their successful legacy result
turn is not a reliable completion marker.
