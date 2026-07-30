# Legacy MariaDB long-lived data migration

## Scope and safety boundary

`tools/legacy-db-migration` is the only supported importer. It has no HTTP
entrypoint, defaults to a read-only dry-run, and requires `--apply` for target
writes. Database URLs are accepted only through environment variables.
PostgreSQL advisory locks serialize an apply per profile, and every target row
uses a stable legacy key with `ON CONFLICT`, so an interrupted run is
repeatable.

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

Kakao members retain `oauth_id`, email and metadata. Cutover sets
`kakao_verified_at` and `kakao_grace_started_at` to the migration time and starts
the verification grace period there. Source rows without an OAuth ID retain
their metadata, but the importer does not invent a provider identifier.

Legacy password hashes remain usable when gateway-api has
`GATEWAY_LEGACY_PASSWORD_GLOBAL_SALT`; a successful login upgrades the stored
value to Argon2id. A test-only account can instead be reset with the CLI and a
mode-0600 password file:

```sh
GATEWAY_DATABASE_URL=... pnpm migrate:legacy -- \
  reset-password --login-id test-user --password-file /secure/password --apply
```

The password is never accepted as an argument or printed.

### Game profiles

| Legacy table                    | Target                   | Policy                                                                |
| ------------------------------- | ------------------------ | --------------------------------------------------------------------- |
| `ng_games`                      | `ng_games`               | Preserve completed season metadata                                    |
| `hall`                          | `hall`                   | Preserve hall-of-fame rows                                            |
| `ng_old_generals`               | `ng_old_generals`        | Preserve full JSON snapshots and owner                                |
| `ng_old_nations`                | `ng_old_nations`         | Preserve all versions, including duplicate server/nation pairs        |
| `emperior`                      | `emperior`               | Preserve dynasty detail and legacy key                                |
| `inheritance_result`            | `inheritance_result`     | Preserve result JSON/string and legacy key                            |
| `user_record`                   | `inheritance_log`        | Preserve complete long-lived user record                              |
| persistent `storage` namespaces | `legacy_game_storage`    | Preserve raw `inheritance_*` and `user_*` rows before projection      |
| `storage:inheritance_point`     | `inheritance_point`      | Project the numeric first tuple item; retain the tuple in raw storage |
| `storage:user`                  | `inheritance_user_state` | Project known current inheritance state; retain raw storage           |
| `ng_history`                    | `yearbook_history`       | Preserve map, nation, global history and global action snapshots      |

The source contains legitimate duplicate `(server_id, nation)` old-nation rows
and `(server_id, year, month)` history rows. `source_id` is consequently part of
the archive unique keys. Runtime-generated rows use `source_id = 0`; migrated
rows use the legacy primary key. This avoids a lossy last-row-wins upsert.

Current-season actor/world/queue/lock/message/market/vote state is explicitly
excluded. In particular, `general`, `city`, `nation`, their turn queues,
`general_record`, `world_history`, `statistic`, `board`, `comment`,
`diplomacy`, `ng_diplomacy`, `event`, `message`, `rank_data`, `troop`,
`tournament`, `vote`, `vote_comment`, season-scoped/unknown `storage`,
`ng_auction`, `ng_auction_bid`,
`ng_betting`, `reserved_open`, `select_pool`, `select_npc_token` and `plock`
must not be used to reconstruct a running season.

## Archived play read model

`/past-plays` is an authenticated, read-only projection. The server derives the
archive owner from the game session and never accepts an owner ID from the
browser.

- `archive.myPastPlays` combines the owner's `ng_old_generals` rows with
  `ng_games`, the latest matching `ng_old_nations` snapshot and an optional
  `emperior` row. It returns summary fields and a link target for the existing
  public dynasty/nation detail.
- `archive.myPastPlayDetail(serverId, generalNo)` includes the session owner in
  the database predicate before returning `data.history`. A foreign or missing
  record uses the same not-found response.
- Legacy `data.history` may be either an array or a `<br>`-joined string. The API
  normalizes both to a newest-first string array, and the frontend renders plain
  text rather than archived markup.
- Runtime death and unification archival writes the current general
  `GENERAL/HISTORY` rows into the same `data.history` field, so newly completed
  seasons remain compatible with imported rows.

## Cutover procedure

1. Keep the original compressed dumps immutable and restore each source to a
   private MariaDB instance.
2. Deploy the gateway and game Prisma migrations to empty staging databases.
3. Run gateway and each non-empty profile without `--apply`; archive the JSON
   counts and excluded-table reasons.
4. Compare source counts, malformed JSON checks and duplicate natural-key
   counts. Stop on unexplained drift.
5. Put the affected target in maintenance mode, take a PostgreSQL backup, then
   run the same commands with `--apply`.
6. Repeat each apply. Counts must remain unchanged.
7. Verify Kakao migration timestamps, password-hash shapes, archive ownership,
   old-nation/history duplicate preservation, `/past-plays` list/detail access,
   foreign-owner denial and the dynasty link.
8. Retain the MariaDB dumps as rollback evidence. Rollback restores the
   pre-cutover PostgreSQL backup; it does not reverse individual importer
   upserts.
