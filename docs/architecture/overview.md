# Architecture Overview

This repository contains both the active legacy PHP game and an in-progress
TypeScript rewrite. The legacy engine remains the source of truth while the
monorepo plan is prepared alongside it.

## Layers

- Legacy runtime: PHP entry points under `legacy/` and `legacy/hwe/`
- Legacy engine core: domain logic under `legacy/hwe/sammo/`
- Legacy frontend: Vue/TypeScript under `legacy/hwe/ts/`
- Rewrite (planned): pnpm workspace monorepo under `packages/` and `app/`

## Legacy Data Migration Policy

- Data under `legacy/` is migration-only and not used by the rewrite at runtime.
- After DB migration completes, legacy data is no longer required.

## Data and State

- PHP engine owns authoritative gameplay state today
- Scenario and unit pack data are loaded from `legacy/hwe/scenario/`
- Deterministic RNG is required for gameplay outcomes

## Cross-Cutting Policies

- No ad-hoc randomness for gameplay; use deterministic RNG
- Keep domain logic independent of endpoints or UI
- Prefer clear Korean comments in core gameplay logic for maintainers

## Runtime Processing (Outline)

This document links to detailed runtime behavior in `docs/architecture/runtime.md`.
Use that document for turn daemon scheduling, API request handling, and
persistence sequencing.

## Documentation TODOs

- Pending follow-ups: `docs/architecture/todo.md`.
