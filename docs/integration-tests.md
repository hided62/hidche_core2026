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
대상 host, port, database와 Redis prefix가 해당 worktree 전용인지 확인해
주세요. Runner는 실행 ID가 포함된 game schema를 생성하고 성공, 테스트 실패,
`HUP`, `INT`, `TERM` 종료에서 자신이 생성한 schema만 삭제합니다. 사용자가
schema 환경 변수를 지정한 경우에도 이미 존재하는 schema는 거부합니다.
HTTP transport fixture의 Redis key도 실행 ID를 profile namespace에 포함하고,
runner 종료 시 그 실행 ID에 속한 key만 삭제합니다. 공유 Redis 전체에
`FLUSHDB`나 `FLUSHALL`을 실행하지 않습니다.
Battle simulator fixture도 실행 ID가 포함된 queue/result/notify namespace를
사용합니다. 실행 중단 시 테스트의 `finally`가 실행되지 않아도 runner가 같은
실행 ID의 key만 찾아 삭제합니다.
Runner는 test process group에 종료 신호를 전달하고 기본 10초 안에 종료되지
않으면 `SIGKILL`로 전환한 뒤 schema와 Redis cleanup을 계속합니다. 이 유예
시간은 중단 경계 검증에서만 `CONDITIONAL_INTEGRATION_TERM_GRACE_SECONDS`
(1~60초)로 줄일 수 있습니다.
`SIGKILL`은 cleanup trap을 실행할 수 없으므로 자동 정리를 보장하지 않습니다.

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

HTTP lifecycle fixture는 disposable profile에
`localAccountGeneralCreationGraceDays`를 명시하고 실제 profile 정책을
통과합니다. PM2 orchestrator fixture는 전용 `PM2_HOME`을 사용하며, 다섯
runtime role을 삭제하고 PID와 명령행 및 daemon 종료를 확인한 뒤에만 임시
디렉터리를 정리합니다. 운영자의 전역 PM2 daemon과 경로를 공유하지 않습니다.

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
- 관리자 시간 가속·연기의 durable action, checkpoint, Redis 부분 재시도와
  경매 timer race

실제 포함 suite는 `tools/run-conditional-integration.sh`, 각 package의
`package.json`, `*.integration.test.ts`를 기준으로 확인합니다. DB 조건부
환경 변수는 `tools/conditional-integration-registry.tsv`에서 명시적으로
관리합니다. 새 `*_DATABASE_URL` gate가 registry에 없거나 registry 항목이
더 이상 테스트에 존재하지 않으면 runner가 테스트 실행 전에 실패합니다.
Registry는 marker 존재 여부뿐 아니라 중복, 형식과 지원 execution mode도
검사합니다. 지원하지 않는 mode로 인해 test가 실행 group에서 빠지는 경우에도
runner는 test 시작 전에 실패합니다. 지원 mode에 marker가 하나도 없거나
실행 group의 marker 정규식이 비어도 전체 파일로 선택 범위를 넓히지 않고
실패합니다.

관리자 시간 조정의 PostgreSQL 경계는
`runtimeClockShiftPersistence.integration.test.ts`, gateway action
`PARTIAL → APPLIED` 경계는 `gatewayRuntimeAction.integration.test.ts`입니다.
Runner는 후자에 `GATEWAY_RUNTIME_ACTION_DATABASE_URL`, 전자에
`INPUT_EVENT_DATABASE_URL`을 같은 격리 schema URL로 주입합니다. 장수 생성,
선택 pool, 즉시 장수 action처럼 별도 marker를 사용하는 테스트도 registry를
통해 포함합니다. DB와 Redis가 함께 필요한 파일은 DB group에서 한 번만
실행하고 Redis-only 파일만 별도 group에서 실행합니다.

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

조건부 runner는 마지막 줄에 통과, skip, 실패한 test file 수를 출력하며,
하나라도 file 전체가 skip되면 성공으로 처리하지 않습니다. 실행이 중단된 경우도
이미 완료된 group의 집계와 schema cleanup 결과를 확인해 주세요.

Ref 호환성 판정은 [차등 검증](architecture/turn-state-differential-testing.md),
UI는 [프론트엔드 호환 검증](frontend-legacy-parity.md)을 함께 사용합니다.
