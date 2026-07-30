# 테스트 정책

## 원칙

- 변경한 계약과 가장 가까운 test부터 실행하고 범위를 넓힙니다.
- deterministic clock, seed와 fixture를 사용합니다.
- ref 호환성은 결과, 순서, RNG, 저장 상태와 출력으로 검증합니다.
- 인증·권한은 session actor, 소유권, role, sanction과 redaction을 포함합니다.
- DB 코드는 실제 PostgreSQL transaction과 reload 경로를 검증합니다.
- UI는 실제 Chromium에서 geometry, computed style과 interaction을 비교합니다.
- skip, baseline failure와 환경 미검증을 pass와 분리합니다.

## 기본 검증

```sh
CI=1 pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

문서만 변경한 경우에도 Markdown link, Prettier, 생성 문서 일치와
`pnpm docs:build`를 확인합니다. 제품 코드 동작을 바꾸지 않은 문서 작업은
typecheck·unit·Chromium 검증을 실행한 것으로 설명하지 않습니다.

## 테스트 계층

### Unit

`packages/common`, `packages/logic`, 각 app의 `test/`가 순수 계산, parser,
constraint, lifecycle과 service를 검증합니다. Gameplay 계산에는 fixed seed와
정확한 state/log 기대값을 사용합니다.

### Integration

`tools/integration-tests`와 `*.integration.test.ts`가 PostgreSQL, Redis,
Fastify transport, Prisma transaction, lease와 worker 경계를 검증합니다.

```sh
pnpm test:integration
pnpm test:integration:conditional
```

조건부 suite는 worktree별 PostgreSQL·Redis instance를 준비합니다. Test가
schema truncate와 Redis 정리를 수행하므로 공유 개발 instance를 사용하지
않습니다.

### Differential

```sh
pnpm check:legacy:general
pnpm check:legacy:nation
```

실제 ref runner와 canonical snapshot 계약은
[차등 검증](architecture/turn-state-differential-testing.md)을 따릅니다.

### Browser

```sh
pnpm test:e2e:frontend-legacy
```

같은 Chromium, viewport, device scale, zoom, locale, font, image, 로그인과
test data를 사용합니다. Screenshot과 함께 `getBoundingClientRect()`와
`getComputedStyle()`을 수집하고 hover, focus, pointer down/up,
checked/selected/disabled, dropdown, modal과 transition을 확인합니다.

## 권한 matrix

API 변경은 최소한 다음 행위자를 구분합니다.

- 무인증
- 인증됐지만 장수가 없는 사용자
- 자기 장수
- 같은 국가의 다른 장수
- 외국 장수
- NPC
- 직책·서비스 role별 사용자
- sanction 대상 사용자

거부 경로는 DB·queue·Redis side effect가 없어야 합니다. Public DTO는 숨겨야
할 field가 빠졌는지 확인하고, role 이름만 비교하지 말고 실제 capability와
resource relation을 검증합니다.

## DB와 migration

Schema 변경은 빈 DB 전체 migration, 기존 DB 증분 migration, 두 번째 deploy의
no-op, unique/FK/index, runtime query와 reload를 확인합니다. 기존 migration
파일과 checksum은 수정하지 않습니다. `prisma db push`는 격리 fixture의
일시적 schema 준비에만 사용합니다.

## 결과 기록

Report에는 실행 명령, commit, 서비스와 fixture, pass/fail/skip 수, baseline
failure, 미검증 경계와 artifact 위치를 기록합니다. Screenshot과 log에는
token, password, 개인정보를 포함하지 않습니다.
