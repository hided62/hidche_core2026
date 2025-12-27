# Legacy Constraint System

This document describes the constraint framework used to validate command
preconditions. References include `legacy/hwe/sammo/Constraint/Constraint.php`
and `legacy/hwe/sammo/Constraint/ConstraintHelper.php`.

## Core Concepts

Constraints are reusable predicate classes that validate a command’s inputs and
state. They are built per-command and executed in order:

- Each constraint extends `Constraint` and implements `test()`.
- `Constraint::testAll()` iterates a list of constraints and returns the first
  failure `[constraintName, reason]` or `null` for success.
- `BaseCommand::hasFullConditionMet()` uses these to decide command validity.

## Required Input Flags

Constraints declare required inputs using bit flags:

- `REQ_GENERAL`, `REQ_CITY`, `REQ_NATION`
- `REQ_DEST_GENERAL`, `REQ_DEST_CITY`, `REQ_DEST_NATION`
- `REQ_ARG` with typed sub-flags:
  - `REQ_STRING_ARG`, `REQ_INT_ARG`, `REQ_NUMERIC_ARG`, `REQ_BOOLEAN_ARG`,
    `REQ_ARRAY_ARG`, `REQ_BACKED_ENUM_ARG`

`Constraint::checkInputValues()` enforces these expectations and throws if
inputs are missing or malformed.

## Constraint Helper DSL

`ConstraintHelper` provides factory-style helpers used in command definitions:

- Examples: `AllowWar()`, `NearCity($distance)`, `ReqGeneralGold($amount)`,
  `NotOccupiedDestCity()`, `AllowDiplomacyStatus(...)`, etc.
- These helpers return `[ConstraintName, arg]` tuples consumed by
  `Constraint::testAll()`.

## Common Constraint Classes

Constraints are organized by domain:

- **Diplomacy**: `AllowDiplomacyStatus`, `AllowDiplomacyBetweenStatus`.
- **Nation/City**: `OccupiedCity`, `NotCapital`, `RemainCityCapacity`.
- **General**: `ReqGeneralCrew`, `ReqGeneralGold`, `MustBeTroopLeader`.
- **Routing**: `HasRoute`, `HasRouteWithEnemy`.

Each constraint sets a failure reason string used by UI and logs.


## Rewrite Constraint Contract (Draft)

This section proposes a shared contract for the rewrite so both the turn daemon
(in-memory) and API server (DB-backed) can evaluate constraints consistently.

### Goals

- Single source of truth for constraint logic.
- Support full evaluation in daemon and precheck in API.
- Explicit data requirements for batching and caching.
- Deterministic reasons for deny vs unknown outcomes.

### Types (TypeScript sketch)

```ts
export type ConstraintResult =
    | { kind: 'allow' }
    | { kind: 'deny'; reason: string; code?: string }
    | { kind: 'unknown'; missing: RequirementKey[] };

export type RequirementKey =
    | { kind: 'general'; id: number }
    | { kind: 'city'; id: number }
    | { kind: 'nation'; id: number }
    | { kind: 'destGeneral'; id: number }
    | { kind: 'destCity'; id: number }
    | { kind: 'destNation'; id: number }
    | { kind: 'arg'; key: string }
    | { kind: 'env'; key: string };

export interface ConstraintContext {
    actorId: number;
    cityId?: number;
    nationId?: number;
    destGeneralId?: number;
    destCityId?: number;
    destNationId?: number;
    args: Record<string, unknown>;
    env: Record<string, unknown>;
    mode: 'full' | 'precheck';
}

export interface StateView {
    has(req: RequirementKey): boolean;
    get(req: RequirementKey): unknown | null;
}

export interface Constraint {
    name: string;
    requires(ctx: ConstraintContext): RequirementKey[];
    test(ctx: ConstraintContext, view: StateView): ConstraintResult;
}
```

### Evaluation Flow

- `ConstraintPlanner` collects requirements across constraints.
- `StateView` loads those requirements (daemon: in-memory, API: DB).
- `test()` returns:
  - `allow` if constraint passes.
  - `deny` with a stable reason/code for UI.
  - `unknown` if required data is missing and `mode === 'precheck'`.

```ts
function evaluateConstraints(
    constraints: Constraint[],
    ctx: ConstraintContext,
    view: StateView,
): ConstraintResult {
    for (const constraint of constraints) {
        const missing = constraint.requires(ctx).filter((req) => !view.has(req));
        if (missing.length && ctx.mode === 'precheck') {
            return { kind: 'unknown', missing };
        }
        const result = constraint.test(ctx, view);
        if (result.kind !== 'allow') {
            return result;
        }
    }
    return { kind: 'allow' };
}
```

### StateView Selection Boundary

The split between in-memory and DB-backed evaluation happens outside the
constraint logic. A factory or loader chooses the `StateView` implementation
based on the execution environment:

- Turn daemon -> `InMemoryStateView` with a full in-memory snapshot.
- API server -> `DbStateView` (or `ProjectedStateView`) that fetches only the
  required fields from the DB or precomputed projections.

This keeps constraints pure and deterministic, while the infrastructure layer
decides how to satisfy `requires()` in each runtime.

### Mapping from Legacy Flags

- `REQ_GENERAL` -> `{ kind: 'general', id: actorId }`
- `REQ_CITY` -> `{ kind: 'city', id: cityId }`
- `REQ_NATION` -> `{ kind: 'nation', id: nationId }`
- `REQ_DEST_*` -> respective `dest` key
- `REQ_ARG` -> `{ kind: 'arg', key: <argName> }`
- `env` dependencies (for example `turnterm`, `year`) -> `{ kind: 'env', key: 'turnterm' }`

### Data Projection Suggestion

- API prechecks can rely on a small read model (for example `general_summary`)
  updated by the turn daemon; `StateView` selects the source per requirement.

## Open Questions / Follow-ups

- Some constraints rely on `env` values (`turnterm`, `year`, etc.); document
  each command’s exact `env` payload when porting.
