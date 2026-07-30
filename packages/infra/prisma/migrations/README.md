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
- `diplomacy`, `event`, `log_entry`, `error_log`
- auction, board, vote, yearbook, archive와 inheritance table
- `nation.chief_general_id`
- `city.trade` nullable, `city.trust` REAL
- `auction_bid.meta` JSONB NOT NULL
- `traffic_period`, `traffic_period_general`과 unique key

검증이 끝나면 이름을 직접 확인한 임시 database와 role만 제거합니다. 공유
database나 Compose volume을 삭제하지 않습니다.
