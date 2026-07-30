# 통합 테스트

## 실행 명령

외부 서비스 없이 실행 가능한 integration:

```sh
pnpm test:integration
```

전용 PostgreSQL·Redis를 사용하는 조건부 suite:

```sh
pnpm test:integration:conditional
```

조건부 runner는 환경 변수 존재 여부만으로 안전성을 보장하지 않습니다.
대상 host, port, database, schema와 Redis prefix가 해당 worktree 전용인지
확인해 주세요.

## 준비

상위 작업공간의 개발 stack을 사용할 수 있습니다.

```sh
cd ../docker_compose_files/development
./scripts/prepare-instance.sh docs-check 15443 16389 ../../core2026
./scripts/compose.sh docs-check up -d --wait

cd ../../core2026
pnpm install --frozen-lockfile
pnpm --filter @sammo-ts/infra prisma:generate
pnpm --filter @sammo-ts/common build
pnpm --filter @sammo-ts/logic build
pnpm test:integration:conditional
```

Instance 이름과 port는 다른 worktree와 겹치지 않게 정합니다. 생성된 `.env`,
`.env.ci`, log와 DB volume은 Git에 추가하지 않습니다.

## 범위

통합 suite는 다음 경계를 포함합니다.

- gateway/game Prisma 연결과 schema
- Redis session, queue와 pub/sub
- scenario initialization과 profile schema
- `InputEvent` 원자성, 재시도와 중복 request
- turn daemon lease, heartbeat, fencing과 takeover
- 예약 턴 revision/CAS와 API/daemon 경합
- auth header, role, sanction과 owner별 HTTP transport
- ref/core command snapshot, RNG trace와 persistence
- auction, tournament와 worker transaction

실제 포함 suite는 `tools/run-conditional-integration.sh`, 각 package의
`package.json`, `*.integration.test.ts`를 기준으로 확인합니다.

## 안전 경계

- Test는 game schema table을 truncate할 수 있습니다.
- Redis key 또는 선택한 DB index를 정리할 수 있습니다.
- 운영·공유 DB URL을 사용하지 않습니다.
- Volume 삭제는 사용자가 데이터 폐기를 명시한 경우에만 수행합니다.
- Secret과 펼쳐진 `docker compose config` 출력은 report나 artifact에 넣지
  않습니다.

## 결과 해석

환경이 없어 skip된 test는 실행되지 않은 것입니다. Mock connector test는 실제
PostgreSQL·Redis 경계를 증명하지 않습니다. Full suite 실패는 변경 worktree와
변경 없는 `main`에서 각각 재현해 회귀와 baseline을 구분합니다.

Ref 호환성 판정은 [차등 검증](architecture/turn-state-differential-testing.md),
UI는 [프론트엔드 호환 검증](frontend-legacy-parity.md)을 함께 사용합니다.
