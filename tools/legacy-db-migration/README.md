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

Kakao members retain their OAuth ID, email, and OAuth metadata.
`kakao_verified_at` and `kakao_grace_started_at` are set to the migration time,
which renews verification at cutover. Legacy password hashes and salts are
retained and upgraded to Argon2id after the first successful login when
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
