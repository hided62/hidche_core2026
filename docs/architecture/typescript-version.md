# TypeScript Version Policy

## Decision

The `core2026` rewrite workspace standardizes on exactly TypeScript `6.0.2`.
TypeScript 7 must not be introduced into individual workspace packages while
this policy is active.

This is a temporary compatibility decision. TypeScript 7 currently does not
provide all compiler/tooling APIs required by this repository and its dependent
tools, which has caused typecheck, lint, and comparison-tool failures. The
workspace will remain on TypeScript 6 until those APIs and the surrounding
tooling support are available.

## Scope

This policy applies to every pnpm workspace package under:

- `app/*`
- `packages/*`
- `tools/*`
- the root development toolchain

All direct `typescript` dependencies in that scope must use the exact version
`6.0.2`. Do not use a caret range, package-local TypeScript 5 fallback, a
TypeScript 7 override, or an alias to another TypeScript version. A single
version must be resolved in `pnpm-lock.yaml`; the root `pnpm-workspace.yaml`
override enforces the same version for transitive TypeScript peer resolution.

The PHP runtime and its historical frontend under `legacy/` are not pnpm
workspace packages and retain their existing toolchain. This exception must not
be used by rewrite packages.

TypeScript 6 reports the existing `baseUrl` configuration as deprecated. The
shared `tsconfig.base.json` sets `ignoreDeprecations` to `6.0` so the current
path mapping continues to work during this compatibility period. Removing or
replacing `baseUrl` remains part of the TypeScript 7 upgrade work; packages must
not add their own suppression values.

## TypeScript 7 Upgrade Gate

Moving to TypeScript 7 requires a deliberate workspace-wide change. Upgrade
only after all of the following are true:

1. The compiler/tooling APIs used by repository scripts are available.
2. `typescript-eslint`, `vue-tsc`, `tsdown`, Vite integrations, and other direct
   TypeScript consumers officially support the selected TypeScript 7 release.
3. `CI=1 pnpm typecheck`, `pnpm lint`, `pnpm build`, and relevant tests pass.
4. Legacy comparison tools, including `pnpm check:legacy:nation`, pass without
   a fallback TypeScript installation or version alias.
5. Every workspace manifest and `pnpm-lock.yaml` is updated together so only
   the approved TypeScript 7 version is resolved for the rewrite workspace.

Until this gate is satisfied, failures caused by running TypeScript 7 are not a
supported baseline and must not be worked around by mixing compiler versions.
