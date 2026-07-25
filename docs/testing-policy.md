# Testing Policy (Draft)

This document summarizes the testing strategy for the Sammo/HiDCHe repository.
The key is to separate "DB behavior emulation" from "state/logic/flow validation"
so each layer is tested with the right scope.

## Historical Test Trust Boundary (2026-07-25)

Tests already present at the 2026-07-25 review baseline
(`main@a05f46130e621ff30fcac330af33c9e7e169f440`) or inherited from an older
commit are **untrusted legacy tests until individually audited**. A large part
of this suite was AI-authored, and some tests appear optimized to make the
current implementation pass rather than to detect incorrect behavior.

Consequently:

- A passing baseline test proves only that its current assertions passed. It
  does not by itself prove legacy compatibility, domain correctness, complete
  side effects, authorization, transaction safety, or production readiness.
- Do not raise a mapping or implementation status to "verified" using only an
  unaudited baseline test.
- Do not preserve behavior merely because an unaudited test expects it. Resolve
  conflicts against the legacy implementation, an approved compatibility
  contract, or an independently captured trace.
- Keep existing tests for possible regression value, but mark each audited test
  or suite with its evidence source and review date.

An audit must confirm that a test:

1. names the behavior and failure mode it is intended to protect;
2. derives expected values independently from the implementation under test;
3. asserts game-impacting numeric state and all relevant persistence side
   effects, rather than only truthiness, types, or absence of exceptions;
4. covers important rejection, boundary, ordering, and concurrency paths;
5. fails when the protected behavior is deliberately perturbed;
6. uses a real DB/Redis or a differential legacy fixture where infrastructure
   semantics or compatibility are part of the contract.

Until this audit is recorded, test counts and green status are inventory
information only, not evidence of correctness.

The executable TypeScript suite was reviewed on 2026-07-25. Its per-suite
disposition, intended scope, and evidence limits are recorded in
[`test-suite-audit.md`](./test-suite-audit.md). A `kept` or `corrected`
disposition means the test has useful regression value at the recorded layer;
it does not promote smoke or contract coverage into legacy-compatibility
evidence. New suites and material scope changes must update that registry.

## Core Principles

- Prefer Repository/DB Port interfaces over ORM mocks; split implementations:
    - InMemory Repository (Fake)
    - Real DB Repository (e.g., Prisma)
- Validate domain constraints in the logic layer where possible; DB constraints
  act as a secondary safety net.
- Use deterministic seeds for all gameplay-impacting RNG.
- Run TypeScript validation with the workspace-standard TypeScript `6.0.2`.
  TypeScript 5 or 7 results do not replace the required repository typecheck.
  See `docs/architecture/typescript-version.md`.

## Test Layers

### 1) Constraint Tests

Goal: ensure constraints (unique/foreign key/check) behave consistently in
both InMemory state and the DB.

- Unit tests: validate domain constraints with InMemory repositories.
- Integration tests: verify the same violations fail in the real DB.
- Mock target: InMemory Repository (Fake).
- Use real DB only in integration tests.

### 2) Game Logic / Command Tests

Goal: verify state input -> state output and that flush behaves as expected.

- Unit tests: run logic against InMemory state and assert outputs.
- Integration tests: execute the same command and confirm DB persistence.
- Mock target: InMemory Repository (Fake).
- "Send to DB" behavior is validated via real DB tests.
- Cross-engine compatibility compares a canonical semantic snapshot rather than
  raw MariaDB/PostgreSQL dumps. General-turn commands use the three-way
  ref DB ↔ core InMemory ↔ core PostgreSQL design in
  [`architecture/general-command-differential-testing.md`](./architecture/general-command-differential-testing.md).

### 3) Turn Flow Tests

Goal: verify the end-to-end scheduler/turn processing flow.

- Nature: integration/system tests.
- Stack: Real DB + (test) Redis.
- RNG uses fixed seeds for determinism.
- Keep a small set of smoke/regression scenarios due to cost.

### 4) Scenario Build Tests

Goal: ensure scenario parsing and DB application are correct.

- Unit tests: parse/validate scenario files (map size, ID collisions, ranges).
- Integration tests: load scenarios into a test DB and verify key tables.

## Result Composition Guidelines

- Unit tests: fast, wide coverage.
- Integration tests: focus on real DB/Redis behavior.
- Smoke tests: minimal coverage of turn flow/build/scenario loading.
- Test-specific Rule Relaxations:
    - To simplify mocking and complex state preparation, the use of `any` type is allowed in test files.
    - Type casting tricks like `as unknown as YourType` are also permitted in test code for convenience.
    - However, test code must still be covered by TypeScript type checking to ensure API consistency and prevent regressions.

## MockDB Conclusion

- "InMemory Repository (Fake)" is more practical than an ORM mock.
- DB-level behavior (constraints/transactions/locks) belongs to integration tests.
