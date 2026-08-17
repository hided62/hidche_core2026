# Legacy MariaDB long-lived data migration

## Scope and safety boundary

`tools/legacy-db-migration` is the only supported importer. It has no HTTP
entrypoint, defaults to a read-only dry-run, and requires `--apply` for target
writes. Database URLs are accepted only through environment variables.
PostgreSQL advisory locks serialize an apply per profile, and every target row
uses a stable legacy key with `ON CONFLICT`, so an interrupted run is
repeatable.

Gateway apply is one PostgreSQL transaction. A game apply records a
`legacy_archive.import_run`: archive and current-user projection writes commit
together with `COMPLETED`, while a rollback leaves a `FAILED` run record. A
repeat import updates archive-owned rows but does not replace a live Gateway
account's password, reset status, login/display identity, OAuth connection,
roles, sanctions, consent, icon or login timestamps.

The source of truth for eligibility is the checked ref schema, not every table
that happens to exist in a dump. Tables outside that schema remain only in the
recovery dump.

### Gateway

| Legacy table    | Target                        | Policy                                                                          |
| --------------- | ----------------------------- | ------------------------------------------------------------------------------- |
| `member`        | `app_user` plus `legacy_data` | Preserve identity, roles/ACL, sanctions, OAuth metadata, password hash and salt |
| `member_log`    | `legacy_member_log`           | Preserve complete JSON action history                                           |
| `banned_member` | `legacy_banned_member`        | Preserve hashed-email ban                                                       |
| `storage`       | `legacy_root_key_value`       | Preserve raw namespace/key/JSON value                                           |
| `system`        | `system`                      | Preserve registration/login switches and notice                                 |
| `login_token`   | none                          | Exclude expired bearer tokens, IP addresses and obsolete PHP sessions           |

Legacy member numbers map to deterministic UUIDs. Existing rows are updated by
that UUID, so references such as `ng_old_generals.owner` remain stable even
when an old account was deleted before the dump.

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

| Legacy table                    | Dedicated target              | Policy                                                                |
| ------------------------------- | ----------------------------- | --------------------------------------------------------------------- |
| `ng_games`                      | `legacy_archive.game_history` | Preserve source profile, opening date, scenario and raw environment   |
| `hall`                          | `legacy_archive.hall`         | Preserve hall-of-fame rows without mixing current records             |
| `ng_old_generals`               | `legacy_archive.general`      | Preserve canonical V1 plus private raw JSON and owner                 |
| `ng_old_nations`                | `legacy_archive.nation`       | Preserve all versions with profile and legacy primary key             |
| `emperior`                      | `legacy_archive.emperor`      | Preserve dynasty detail under a central archive ID                    |
| `inheritance_result`            | `inheritance_result`          | Preserve result JSON/string and legacy key                            |
| `user_record`                   | `inheritance_log`             | Preserve complete long-lived user record                              |
| persistent `storage` namespaces | `legacy_game_storage`         | Preserve raw `inheritance_*` and `user_*` rows before projection      |
| `storage:inheritance_point`     | `inheritance_point`           | Project the numeric first tuple item; retain the tuple in raw storage |
| `storage:user`                  | `inheritance_user_state`      | Project known current inheritance state; retain raw storage           |
| `ng_history`                    | `legacy_archive.yearbook`     | Preserve map, nation, global history and global action snapshots      |

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
   private MariaDB instance.
2. Deploy the gateway and game Prisma migrations to empty staging databases.
3. Run gateway and each non-empty official profile without `--apply`; archive the JSON
   counts and excluded-table reasons.
4. Compare source counts, malformed JSON checks and duplicate natural-key
   counts. Stop on unexplained drift.
5. Put the affected target in maintenance mode, take a PostgreSQL backup, then
   run the same commands with `--apply`.
6. Repeat each apply. Counts must remain unchanged; verify the newest
   `legacy_archive.import_run` is `COMPLETED` and current Gateway credentials
   are unchanged.
7. Verify valid/invalid Kakao-ID classification, password-reset-required rows,
   Kakao password setup, CLI fallback, archive ownership, canonical source
   format counts, opening dates, `/past-plays`, foreign-owner denial, legacy
   Hall and legacy Dynasty source switches.
8. Retain the MariaDB dumps as rollback evidence. Rollback restores the
   pre-cutover PostgreSQL backup; it does not reverse individual importer
   upserts.
