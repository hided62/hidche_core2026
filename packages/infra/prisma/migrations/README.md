# Game database migration

`game.prisma`의 운영·검증 database는 이 디렉터리의 migration chain으로
준비합니다. `prisma db push`는 정식 migration을 대신하지 않습니다.

## 적용

Git에서 제외된 환경 파일 또는 secret 주입으로 `DATABASE_URL`을 설정합니다.

```sh
pnpm --filter @sammo-ts/infra prisma:migrate:deploy:game
pnpm --filter @sammo-ts/infra prisma:migrate:status:game
```

`20250101000000_init_game_schema`가 game schema의 baseline입니다. Baseline과
적용된 migration 파일·checksum은 수정하지 않고 새 timestamp migration을
추가합니다.

## 빈 DB 검증

전용 임시 PostgreSQL database에 deploy를 두 번 실행합니다. 첫 실행은 전체
chain을 적용하고 두 번째 실행은 `No pending migrations to apply`여야 합니다.

최소 확인 항목은 다음과 같습니다.

- `_prisma_migrations`의 모든 행이 완료 상태
- `world_state`, `nation`, `city`, `general`, `message`, `troop`
- `general_turn`, `nation_turn`과 revision·lease field
- `input_event`, `turn_daemon_lease`
- `read_model_revision`, `read_model_outbox`, `read_model_revision_meta`, `web_push_outbox`
- 두 outbox의 `available_at`, `locked_at`, `delivered_at`, `created_at`은
  millisecond 정밀도 `timestamp without time zone`을 유지한다. 이 migration
  이후 신규 값과 pending/dispatcher 운영 계약은 UTC wall 값으로 통일하되,
  이미 전달된 과거 행의 표시용 시각 전체를 일괄 재해석하지 않는다.
- `read_model_revision_meta.id=1`의 `coverage_version=0`
- `diplomacy`, `event`, `log_entry`, `error_log`
- auction, board, vote, yearbook, archive와 inheritance table
- `nation.chief_general_id`
- `city.trade` nullable, `city.trust` REAL
- `auction_bid.meta` JSONB NOT NULL
- `traffic_period`, `traffic_period_general`과 unique key
- `general_access_batch`, primary key와 `created_at` index
- `select_npc_token`, `select_npc_token_valid_until_idx`
- `general_user_id_key`

검증이 끝나면 이름을 직접 확인한 임시 database와 role만 제거합니다. 공유
database나 Compose volume을 삭제하지 않습니다.

## Game outbox UTC-wall populated upgrade 검증

Git에서 제외된 전용 PostgreSQL URL을 주입해 target 직전 migration chain부터
실제 data upgrade와 두 번째 deploy no-op까지 검증합니다.

```sh
GAME_OUTBOX_MIGRATION_TEST_DATABASE_URL=... \
  pnpm --filter @sammo-ts/infra verify:migration:outbox-utc
```

검증기는 실행별 소유권 comment가 있는 schema만 만들고 정리합니다. KST DB
default로 생성된 ReadModel `created_at`의 UTC-wall 변환, 기존 JavaScript UTC
WebPush `created_at` 보존, 두 pending outbox의 requeue·lease 해제, delivered 행
보존, target checksum과 이전 DML shape 호환성을 확인합니다. 이전 binary를 별도
build해 실행하거나 down migration을 제공한다는 뜻은 아닙니다.

## NPC selection 중복 owner preflight

`20260731000000_add_npc_selection_token`은 `general.user_id` 중복을 발견하면
token table과 unique index를 만들기 전에 실패합니다. 실제 Prisma 실패
metadata와 운영자 정리 뒤 recovery를 전용 tmpfs PostgreSQL에서 검증합니다.

```sh
pnpm --filter @sammo-ts/infra verify:migration:npc-selection
```

검증기는 target 직전 migration 상태에 synthetic 중복 owner를 넣고 다음
순서를 확인합니다.

1. `migrate deploy`가 실패합니다. Prisma 7.2 CLI의 최상위 오류는 내부
   owner 진단 대신 `current transaction is aborted`로 표시됩니다.
2. migration transaction의 table/index DDL이 남지 않습니다.
3. target `_prisma_migrations`에는 `finished_at`, `rolled_back_at`, `logs`가
   모두 NULL이고 `applied_steps_count=0`인 미완료 행이 하나 남습니다.
4. 재실행은 이 미완료 이력 때문에 P3009로 차단됩니다.
5. 중복을 정리하고 target을 `--rolled-back`으로 resolve한 뒤 deploy가
   성공합니다.
6. 두 번째 deploy는 no-op이고 migration status가 clean입니다.

검증기는 `postgres:18.4-bookworm` container의 데이터 경로를 tmpfs로
mount하며 Docker volume을 만들지 않습니다. 임의 포트와 실행 고유 schema를
사용하고 EXIT/HUP/INT/TERM에서 소유 label을 확인한 정확한 container만
제거합니다.

운영 복구에서는 중복 owner를 임의 삭제하지 말고 진단된 계정과 장수를
확인해 주세요. CLI 오류가 일반 transaction 오류만 표시하면 다음 read-only
query로 대상을 확인합니다.

```sql
SELECT
    user_id,
    count(*) AS owner_count,
    string_agg(id::TEXT, ',' ORDER BY id) AS general_ids
FROM general
WHERE user_id IS NOT NULL
GROUP BY user_id
HAVING count(*) > 1
ORDER BY user_id;
```

중복 원인을 정리한 뒤 다음처럼 실패한 target만 rolled-back으로 표시하고
deploy를 다시 실행합니다.

```sh
pnpm --filter @sammo-ts/infra exec prisma migrate resolve \
  --rolled-back 20260731000000_add_npc_selection_token \
  --schema prisma/game.prisma
pnpm --filter @sammo-ts/infra prisma:migrate:deploy:game
```

다른 migration을 resolve하거나 중복을 정리하기 전에 resolve하지 말아
주세요. 이 migration에는 성공 적용을 되돌리는 down migration이 없습니다.
성공 뒤 복구가 필요하면 사전 DB backup을 복원하거나 별도 forward
migration을 작성해 주세요.
