# Game database migrations

`game.prisma`의 운영·검증 DB는 이 디렉터리의 migration chain으로
준비한다. 새 환경을 `prisma db push`만으로 만들지 않는다.

## 적용

Git에서 제외된 환경 파일 또는 secret 주입으로 `DATABASE_URL`을 설정한 뒤
저장소 루트에서 실행한다.

```bash
pnpm --filter @sammo-ts/infra prisma:migrate:deploy:game
pnpm --filter @sammo-ts/infra prisma:migrate:status:game
```

`20250101000000_init_game_schema`는 증분 migration 이력이 생기기 전에
`db push`로 제공되던 핵심 game table의 baseline이다. 기존 설치에는
이미 같은 object가 있으므로 type, table과 index 생성은 idempotent하게
작성했다. 새 migration은 이 baseline 또는 기존 migration 파일을
수정하지 말고 뒤에 추가한다.

## 빈 DB 검증

다른 개발 DB나 volume을 재사용하지 말고 전용 임시 PostgreSQL database를
만든다. 위 deploy 명령을 한 번 실행해 전체 migration이 성공하는지,
두 번째 실행이 `No pending migrations to apply`인지 확인한다. 최소한
다음도 확인한다.

- `_prisma_migrations`의 모든 행이 완료 상태
- `world_state`, `nation`, `city`, `general`, `message`, `troop`,
  `general_turn`, `nation_turn`, `diplomacy`, `event`, `log_entry`,
  `error_log` 존재
- `nation.chief_general_id` 존재
- `city.trade` nullable, `city.trust` REAL
- `auction_bid.meta` JSONB, NOT NULL
- `traffic_period`, `traffic_period_general` 존재 및
  `(world_state_id, year, month)`/`(period_id, general_id)` unique key

검증 뒤에는 이름을 확인한 임시 database와 role만 제거한다. 공유 개발
database나 Compose volume을 삭제하지 않는다.
