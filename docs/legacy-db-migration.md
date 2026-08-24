# Legacy MariaDB long-lived data migration

## Scope and safety boundary

`tools/legacy-db-migration` is the only supported importer. It has no HTTP
entrypoint, defaults to a read-only dry-run, and requires `--apply` for target
writes. The normal `run-plan` command reads a mode-0600 JSON file containing
structured MariaDB host/database/user settings and a password, password-file
reference or password environment name. PostgreSQL URLs remain in environment
variables; no URL or password is accepted as a command-line value or returned
in JSON output. PostgreSQL advisory locks serialize an apply per source/profile,
and every target row uses a stable legacy key with `ON CONFLICT`, so an
interrupted run is repeatable.

Gateway apply is one PostgreSQL transaction and records `legacy_import_run`.
A game apply records `legacy_archive.import_run`: archive and current-user
projection writes commit together with `COMPLETED`, while a rollback leaves a
`FAILED` run record. Their checkpoint updates commit in the same transaction as
the imported rows. A repeat import updates archive-owned rows but does not
replace a live Gateway account's password, reset status, login/display identity,
OAuth connection, roles, sanctions, consent, icon or login timestamps.

### Full and incremental execution

`run-plan` first connects to every configured MariaDB and PostgreSQL target and
checks that the checkpoint migrations exist. Only after all stages pass does it
run Gateway, then `che,kwe,pwe,twe,nya,pya,hwe` in that order, skipping disabled
profiles. Dry-run and apply use the same transformations and return per-table
`progress` with strategy, start cursor, end cursor and processed count.
`check-plan` additionally returns an `inventory` array for every stage. Each
entry names the source, target, full/incremental strategy and the user-visible or
archival information transferred, so the reviewed plan itself is the migration
manifest rather than an implicit table list.

The initial apply uses `--mode full`. A later `--mode incremental` requires the
same `sourceSet` and a completed checkpoint for every append-only table.
`member_log`, `hall`, `ng_old_generals`, `ng_old_nations`, `emperior`,
`inheritance_result`, `user_record` and `ng_history` continue strictly after the
stored primary-key cursor. Mutable `member`, root/game `storage`, `system`, bans
and `ng_games` are rescanned and upserted. The source fingerprint includes
protocol, host, port, database, user and non-secret connection options but not
the password, so password rotation is safe while an accidental database switch
is rejected. A regressed maximum ID is also rejected.

This is an append-plus-rescan importer, not bidirectional replication. It does
not copy source deletions and cannot discover an in-place edit to a completed
append-only row behind the high-water mark. Such a source requires a reviewed
full re-import and count/hash investigation.

The source of truth for eligibility is the checked ref schema, not every table
that happens to exist in a dump. Tables outside that schema remain only in the
recovery dump.

### Gateway

| Legacy table    | Target                                 | Policy                                                                                        |
| --------------- | -------------------------------------- | --------------------------------------------------------------------------------------------- |
| `member`        | `app_user`, `user_icon`, `legacy_data` | Preserve identity, account icon, roles/ACL, sanctions, OAuth metadata, password hash and salt |
| `member_log`    | `legacy_member_log`                    | Preserve complete JSON action history                                                         |
| `banned_member` | `legacy_banned_member`                 | Preserve hashed-email ban                                                                     |
| `storage`       | `legacy_root_key_value`                | Preserve raw namespace/key/JSON value                                                         |
| `system`        | `system`                               | Preserve registration/login switches and notice                                               |
| `login_token`   | none                                   | Exclude expired bearer tokens, IP addresses and obsolete PHP sessions                         |

Legacy member numbers map to deterministic UUIDs. Existing rows are updated by
that UUID, so references such as `ng_old_generals.owner` remain stable even
when an old account was deleted before the dump.

Ref appends `?=YYYYMMDD` to a custom icon filename as an HTTP cache marker; it
is not part of the stored filename. A Gateway plan with `userIcons` validates
every referenced byte before any upload. It reads legacy `d_pic` files without
following symlinks, checks the Ref 50 KiB/64~128px square/format contract, and
uploads the original bytes through sam-image's signed immutable upload API.
The deterministic per-account object name makes an interrupted apply safe to
repeat without putting user data in the image Git repository. Existing
`users/core/...` upload paths are fetched and validated instead of copied.

Only after every source icon validates and every legacy file upload succeeds
does the PostgreSQL transaction begin. The returned `icons/users/core2026/...`
path is checked exactly, stored as `users/core2026/...` with `image_server=0`,
and connected to an owned `user_icon` row. An unchanged Ref selection is moved
to that path. A newer Core selection is not overwritten; its imported Ref icon
is retained as another library entry. If the Core account is currently on the
default icon, the imported Ref entry is recorded retired so a prior selection
is not silently resurrected. The original Ref path, `IMGSVR`, returned path and
byte SHA-256 remain in `legacy_data`. Picture collisions across owners fail the
transaction.

Kakao members retain `oauth_id`, email and metadata. A non-empty provider ID is
required before an imported row is marked Kakao-verified. A parseable legacy
`token_valid_until` is copied to `kakao_talk_verified_until`, preserving the
remaining KakaoTalk ownership-proof interval instead of forcing an immediate
message at cutover. Valid provider rows also receive `kakao_verified_at`; all
rows receive
`kakao_grace_started_at` to the migration time and starts the local-account
verification grace period there. Source rows without an OAuth ID retain their
metadata but are not treated as verified, and the importer never invents a
provider identifier.

Every imported 128-hex legacy password is marked `password_reset_required`.
The dump contains the per-user salt but not Ref's installation-wide salt, so
the dump alone cannot validate the old plaintext password. If the original
`GATEWAY_LEGACY_PASSWORD_GLOBAL_SALT` is recovered through the runtime secret,
a successful password login upgrades the value to Argon2id and clears the
flag. Otherwise, a Kakao login (including a confirmed retained-email relink)
issues a one-time password-setup challenge before any normal session; the new
password is sent in the existing RSA envelope and clears the flag. Accounts
without usable Kakao recovery require the CLI and a mode-0600 password file:

```sh
GATEWAY_DATABASE_URL=... pnpm migrate:legacy -- \
  reset-password --login-id test-user --password-file /secure/password --apply
```

The password is never accepted as an argument or printed.

### Game profiles

| Legacy table                       | Dedicated target                       | Policy                                                                     |
| ---------------------------------- | -------------------------------------- | -------------------------------------------------------------------------- |
| `ng_games`                         | `legacy_archive.game_history`          | Preserve source profile, opening date, scenario and raw environment        |
| `hall`                             | `legacy_archive.hall`                  | Preserve hall-of-fame rows without mixing current records                  |
| `ng_old_generals`                  | `legacy_archive.general`               | Preserve canonical V1 plus private raw JSON and owner                      |
| preserved `batres<general_no>.txt` | `legacy_archive.general_battle_result` | Preserve exact old per-general battle-result summaries; exclude phase logs |
| `ng_old_nations`                   | `legacy_archive.nation`                | Preserve all versions with profile and legacy primary key                  |
| `emperior`                         | `legacy_archive.emperor`               | Preserve dynasty detail under a central archive ID                         |
| `inheritance_result`               | `inheritance_result`                   | Preserve result JSON/string and legacy key                                 |
| `user_record`                      | `inheritance_log`                      | Preserve complete long-lived user record                                   |
| persistent `storage` namespaces    | `legacy_game_storage`                  | Preserve raw `inheritance_*` and `user_*` rows before projection           |
| `storage:inheritance_point`        | `inheritance_point`                    | Project the numeric first tuple item; retain the tuple in raw storage      |
| `storage:user`                     | `inheritance_user_state`               | Project known current inheritance state; retain raw storage                |
| `ng_history`                       | `legacy_archive.yearbook`              | Preserve map, nation, global history and global action snapshots           |

The archive schema is shared by all game-profile schemas in the PostgreSQL
database. Every natural key contains `source_profile`; the accepted profiles
are `che`, `kwe`, `pwe`, `twe`, `nya`, `pya`, and `hwe`. This prevents equal
legacy IDs from different servers from colliding while allowing any profile API
to read one central archive.

`ng_games.date` is retained as `legacy_date`. The displayed opening date uses
`env.opentime`, then `env.starttime`, then `ng_games.date`. The dumps do not
carry a trustworthy completion timestamp, so `completed_at` remains null
instead of treating the opening date as completion.

`ng_old_generals.data` is adapted at import time to
`ArchivedGeneralSnapshotV1`. Both old `leader/power` with
`dex0/10/20/30/40` and newer `leadership/strength` with `dex1..5` map to one
shape. Missing battle aggregates and logs are `null` plus explicit
`availability`, never fabricated zeroes. The source JSON remains in
`legacy_archive.general.raw_data` for recovery, but no API returns it.

Ref also retains heterogeneous per-season filesystem trees under
`logs/preserved`. When a profile plan supplies `battleResults.directory` and,
optionally, `sshHost`, the importer selects only immediate regular files matching
`<profile>_*/batres<general_no>.txt`. The filename and directory provide the
same `(source_profile, server_id, general_no)` key as the archived general.
Exact UTF-8 text, line count, source bytes and SHA-256 are stored; the archive
API returns the lines newest-first like Ref and the frontend renders stripped
plain text, never trusted archived HTML.

Every season gets a content manifest and checkpoint. Full apply can add or
atomically replace a changed season and is resumable at season boundaries.
Incremental apply requires a prior full checkpoint, accepts only new immutable
seasons and rejects a changed checkpointed season or changed filesystem source
identity. Both modes reject a disappeared checkpointed season instead of
silently retaining stale data.
`check-plan` reports season/file/byte totals without returning log contents.

The importer deliberately excludes `batlog*` phase-by-phase battle detail,
`gen*` action logs, tournament `fight*`, SQLite API logs and administrative or
operational files. The production preserved trees contain battle-result files
only for the older filesystem-log era (observed seasons end around May 2020),
while later reset-time `general_record` rows were not retained in these trees.
Consequently this feature recovers meaningful old `batres` summaries but cannot
claim complete battle-result coverage for every historical season. Missing data
stays explicitly unavailable.

The source contains legitimate duplicate `(server_id, nation)` old-nation rows
and `(server_id, year, month)` history rows. `source_id` is consequently part of
their current-schema archive keys, while the dedicated legacy archive uses
`(source_profile, legacy_id)` from the original primary key. This avoids a lossy
last-row-wins upsert and keeps runtime current archives separate.

Current-season actor/world/queue/lock/message/market/vote state is explicitly
excluded. In particular, `general`, `city`, `nation`, their turn queues,
`general_record`, `world_history`, `statistic`, `board`, `comment`,
`diplomacy`, `ng_diplomacy`, `event`, `message`, `rank_data`, `troop`,
`tournament`, `vote`, `vote_comment`, season-scoped/unknown `storage`,
`ng_auction`, `ng_auction_bid`,
`ng_betting`, `reserved_open`, `select_pool`, `select_npc_token` and `plock`
must not be used to reconstruct a running season.

### Current-season comparison fixture

The archive exclusion above remains the production migration contract. The
same CLI also provides a separately guarded `current-season-fixture` command for
an isolated Ref/Core comparison database only. It requires a Core template and
Ref source that already match the explicitly supplied scenario/year/month, and
an apply requires `--replace-current-season --apply` together.

Within one target transaction it truncates season-owned tables and imports the
Ref world clock, dynamic city fields, nations, generals, command queues,
diplomacy matrix, troops, ranks, messages, access log, events, betting, auctions,
yearbook, current storage audit rows and general/world logs. Static Core city
geometry and connection metadata remain from the cloned template. Legacy
message payload targets are renamed from `id`/`nation_id` to
`generalId`/`nationId` so the typed Core API can read them.

The command refuses an active turn-daemon lease. It intentionally omits process
locks, reservations and selection tokens, Redis-owned tournament state,
`statistic` aggregate text and `ng_diplomacy` letters; the result reports each
unsupported category. Owner binding for a browser-capture account is explicit
through `CURRENT_SEASON_CAPTURE_USER_ID` and
`CURRENT_SEASON_CAPTURE_SOURCE_OWNER`. This mode must not be used for a live
season or as a substitute for the long-lived archive cutover procedure.

## Archived play read model

`/past-plays` is an authenticated, read-only projection. The server derives the
archive owner from the game session and never accepts an owner ID from the
browser.

- `archive.myPastPlays` reads the central legacy archive across profiles and
  current runtime archives, tags each source, and suppresses a current-schema
  duplicate when the central legacy copy exists.
- `archive.myPastPlayDetail(source, sourceProfile, serverId, generalNo)` includes
  the session owner in the database predicate. A foreign or missing record uses
  the same not-found response.
- The detail DTO feeds the same `GeneralBasicCard`, battle summary,
  `LegacyGeneralProgress`, and record panels used by My Page/Battle Center.
  Missing battle/mastery/log channels show an explicit not-preserved state.
- Legacy `data.history` may be either an array or a `<br>`-joined string. It is
  normalized to plain-text archive entries; archived markup is never rendered
  as trusted HTML.
- Runtime death and unification archival writes the current general
  `GENERAL/HISTORY` rows into the same `data.history` field, so newly completed
  seasons remain compatible with imported rows.

Hall-of-fame and dynasty APIs and pages take an explicit `current` or `legacy`
source. Legacy results use the central archive and show the source profile;
they are never merged into the current rankings or current dynasty list.

## Cutover procedure

1. Keep the original compressed dumps immutable and restore each source to a
   private MariaDB instance. Record checksums and the snapshot boundary.
2. Copy `migration-plan.example.json` to the ignored `migration-plan.json`, give
   it and every password file mode 0600, and enter one stable `sourceSet`.
3. Deploy the gateway and game Prisma migrations to staging, then run
   `check-plan`. Fix every connection, source-table and target-migration failure
   before continuing.
4. Run `run-plan --mode full` without `--apply`; archive the redacted JSON counts,
   excluded-table reasons and source-format summary.
5. Compare source counts, malformed JSON checks and duplicate natural-key
   counts. Stop on unexplained drift.
6. Put the affected target in maintenance mode, take a PostgreSQL backup, then
   run the identical plan with `--mode full --apply`.
7. Verify every Gateway/game run is `COMPLETED`, checkpoints equal the source
   maxima, target counts match, and current Gateway credentials are unchanged.
8. Verify valid/invalid Kakao-ID classification, password-reset-required rows,
   Kakao password setup, CLI fallback, archive ownership, canonical source
   format counts, opening dates, `/past-plays`, foreign-owner denial, legacy Hall
   and legacy Dynasty source switches.
9. For the later snapshot, retain the same `sourceSet`, run `check-plan`, then
   `run-plan --mode incremental` and review every start/end cursor before adding
   `--apply`. Repeat once: append-table processed counts must be zero and target
   row counts must remain unchanged.
10. Retain both MariaDB snapshots and plan-output evidence. Rollback restores the
    pre-cutover PostgreSQL backup; it does not reverse individual importer
    upserts or edit checkpoint rows by hand.
