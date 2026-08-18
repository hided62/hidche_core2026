# Legacy DB migration CLI

This package migrates the long-lived parts of a restored or still-readable ref
MariaDB database into the core2026 PostgreSQL schemas. It is CLI-only; no HTTP
or administrator route invokes it. `run-plan` is the normal operator entrypoint:
it validates every configured connection first, then runs Gateway followed by
the enabled game profiles in the official order.

The default mode is a read-only dry-run. `--apply` is required before any target
write. PostgreSQL advisory locks prevent two applies for the same target.
Gateway writes are transactional. Game archive writes and their completed
`legacy_archive.import_run` record are transactional. Both paths record an
import run and durable per-table checkpoints. Stable legacy keys make completed
or interrupted runs repeatable.

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

## Ordered migration plan

Copy `migration-plan.example.json` to the Git-ignored `migration-plan.json`.
Set its mode to 0600, then enter the MariaDB host, port, database and user for
Gateway and each game profile. A password can come from a separate mode-0600
file (recommended), an environment variable, or directly from the mode-0600
plan. Target PostgreSQL URLs remain in the named environment variables.

```sh
mkdir -p tools/legacy-db-migration/secrets
chmod 700 tools/legacy-db-migration/secrets
cp tools/legacy-db-migration/migration-plan.example.json \
  tools/legacy-db-migration/migration-plan.json
chmod 600 tools/legacy-db-migration/migration-plan.json
chmod 600 tools/legacy-db-migration/secrets/*

pnpm migrate:legacy -- check-plan \
  --config tools/legacy-db-migration/migration-plan.json
pnpm migrate:legacy -- run-plan \
  --config tools/legacy-db-migration/migration-plan.json --mode full
pnpm migrate:legacy -- run-plan \
  --config tools/legacy-db-migration/migration-plan.json --mode full --apply
```

`check-plan` opens every source and target without writing. `run-plan` also
preflights every stage before the first import, is a dry-run without `--apply`,
and stops at the first failed stage. Completed earlier stages remain committed;
rerunning is safe because the Gateway and each profile have independent locks,
transactions and run records. The JSON output never includes a connection URL
or password.

For a later delta, keep the same `sourceSet`, connection identity and source
databases, restore or expose the newer snapshot, then run:

```sh
pnpm migrate:legacy -- run-plan \
  --config tools/legacy-db-migration/migration-plan.json --mode incremental
pnpm migrate:legacy -- run-plan \
  --config tools/legacy-db-migration/migration-plan.json --mode incremental --apply
```

Incremental mode refuses to start without checkpoints from a completed full
apply. It also refuses a changed host/database/user identity or a source table
whose maximum ID moved behind its checkpoint. Password rotation does not change
the source fingerprint.

| Source data                                   | Incremental policy                                                    |
| --------------------------------------------- | --------------------------------------------------------------------- |
| `member_log`                                  | Read only IDs after the committed high-water mark.                    |
| game archive/event-history tables             | Read only IDs after the profile checkpoint.                           |
| `member`, root/game `storage`, `system`, bans | Rescan and idempotently upsert because old rows are mutable.          |
| `ng_games`                                    | Rescan because a season row can gain its final winner after creation. |

The append policy assumes Ref primary keys are never reused and completed
archive rows are immutable. Incremental mode does not mirror source deletions.
If either assumption is false, take a new reviewed backup and run full mode;
do not edit checkpoint rows by hand.

The command reads MariaDB only. Ref `logs/preserved/<season>/` directories are
heterogeneous filesystem archives (old general/battle text, tournament text,
SQLite API logs, and operational logs), not an incremental database feed.
`ng_old_generals.data.history` and `ng_history` carry the supported long-lived
history. Do not point this CLI at, copy, or infer database rows from preserved
log files; a file-log archive needs a separate reviewed migration contract.

## Commands

```sh
LEGACY_ROOT_DATABASE_URL=... pnpm --filter @sammo-ts/legacy-db-migration migrate gateway
LEGACY_GAME_DATABASE_URL=... pnpm --filter @sammo-ts/legacy-db-migration migrate game --profile che
```

After reviewing the JSON counts and excluded-table reasons, add
`GATEWAY_DATABASE_URL` or `GAME_DATABASE_URL` and repeat with `--apply`.

For game archives, `GAME_DATABASE_URL` points at that profile's Core schema.
The importer writes completed-history data to the shared
`legacy_archive` PostgreSQL schema and writes only inheritance projections to
the selected current profile schema. Accepted profiles are
`che,kwe,pwe,twe,nya,pya,hwe`; run them separately against the same PostgreSQL
database.

The individual commands also accept `--mode incremental` and `--source-key`.
Use the ordered plan for production so every configured connection is checked
before the Gateway stage starts.

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

Kakao members retain their OAuth ID, email, and OAuth metadata. Only a row with
a non-empty OAuth ID receives `kakao_verified_at`.
`kakao_grace_started_at` is set to the migration time.
The existing `token_valid_until` is copied to `kakao_talk_verified_until` for
Kakao rows so a still-current “send to me” proof remains current after cutover.
Imported 128-hex password hashes are marked for reset. They can be upgraded to
Argon2id after the first successful login only when the DB-external
`GATEWAY_LEGACY_PASSWORD_GLOBAL_SALT` is safely recovered. Otherwise, a verified
Kakao flow requires a new password before session issuance. A non-Kakao account
uses the CLI reset below. Reapplying a dump preserves the target account's
current credential, OAuth, identity, roles, sanctions, consent, and login state.

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
