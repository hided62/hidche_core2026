# Legacy DB migration CLI

This package migrates the long-lived parts of a restored ref MariaDB database
into the core2026 PostgreSQL schemas. It is CLI-only; no HTTP or administrator
route invokes it.

The default mode is a read-only dry-run. `--apply` is required before any target
write. PostgreSQL advisory locks prevent two applies for the same target. Every
write uses a stable legacy key and `ON CONFLICT`, so a completed or interrupted
run can be repeated.

## Source restore

Restore each compressed table dump into a private MariaDB database before
running this tool. Do not expose that database on a public interface. The dump
directory is intentionally Git-ignored.

```sh
gzip -cd /path/to/db_dumps/root/member.sql.gz | mariadb root_dump
gzip -cd /path/to/db_dumps/che/ng_games.sql.gz | mariadb che_dump
```

Restore all tables defined by ref even though the CLI intentionally projects
only long-lived tables. This lets the dry-run verify the source inventory and
keeps the original dump as the recovery source.

Database URLs belong in a Git-ignored environment file or injected process
environment. They are deliberately not accepted as command-line flags.

## Commands

```sh
LEGACY_ROOT_DATABASE_URL=... pnpm --filter @sammo-ts/legacy-db-migration migrate gateway
LEGACY_GAME_DATABASE_URL=... pnpm --filter @sammo-ts/legacy-db-migration migrate game --profile che
```

After reviewing the JSON counts and excluded-table reasons, add
`GATEWAY_DATABASE_URL` or `GAME_DATABASE_URL` and repeat with `--apply`.

### Isolated current-season comparison fixture

`current-season-fixture` is separate from the long-lived archive migration. It
replaces the running-season tables of an isolated Core test schema with a Ref
MariaDB season so both implementations can be compared from the same persisted
world. Never run it against a production or shared development schema.

Start from a cloned Core database whose scenario, year and month already match
the Ref source. Dry-run verifies that contract and reports the planned counts:

```sh
LEGACY_GAME_DATABASE_URL=... GAME_DATABASE_URL=... \
  pnpm --filter @sammo-ts/legacy-db-migration migrate current-season-fixture \
  --profile hwe --expected-scenario 2601 --expected-year 186 --expected-month 1
```

Applying requires both destructive flags so an ordinary archive command cannot
replace a running season accidentally:

```sh
LEGACY_GAME_DATABASE_URL=... GAME_DATABASE_URL=... \
  pnpm --filter @sammo-ts/legacy-db-migration migrate current-season-fixture \
  --profile hwe --expected-scenario 2601 --expected-year 186 --expected-month 1 \
  --replace-current-season --apply
```

The importer preserves the Core template's static city geometry and connection
metadata, then imports Ref cities, nations, generals, queues, diplomacy, troops,
ranks, messages, logs, events, markets, yearbook rows, current storage values and
world clock in one PostgreSQL transaction. Ref message target keys are converted
to the typed Core message payload. `CURRENT_SEASON_CAPTURE_USER_ID` may bind one
Ref owner selected by `CURRENT_SEASON_CAPTURE_SOURCE_OWNER` to an existing Core
test account; other positive owners receive deterministic legacy UUIDs.

Process locks, selection tokens, Redis-owned tournament brackets, legacy annual
aggregate text and diplomatic-letter workflow are deliberately excluded and are
listed in the JSON result. This fixture is evidence for persisted-state and GUI
comparison, not proof that the two engines consume RNG identically after the
next turn.

Kakao members retain their OAuth ID, email, and OAuth metadata.
`kakao_verified_at` and `kakao_grace_started_at` are set to the migration time.
The existing `token_valid_until` is copied to `kakao_talk_verified_until` for
Kakao rows so a still-current “send to me” proof remains current after cutover.
Legacy password hashes and salts are retained and upgraded to Argon2id after
the first successful login when
`GATEWAY_LEGACY_PASSWORD_GLOBAL_SALT` is configured in gateway-api.

Only tables present in the checked ref schemas are eligible. Extra tables found
in a dump, such as an old root `config` table, are left in the recovery dump and
are not silently imported.

For an isolated test account, put a temporary password in a mode-0600 file and
run:

```sh
GATEWAY_DATABASE_URL=... pnpm --filter @sammo-ts/legacy-db-migration migrate \
  reset-password --login-id test-user --password-file /secure/path/password --apply
```

The password value is never accepted on the command line or printed.
