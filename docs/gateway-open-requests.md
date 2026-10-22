# Gateway 오픈 요청

`/gateway/open-suggestion`에서 정식 사용자가 다음 기수의 설정과 가오픈·정식 오픈
시각을 제출한다. 이전 문구 복사 도구를 확장한 Core 전용 기능이다. 게임 초기화,
서버 패치와 공개 예약 공지는 기존 RESET 경로를 사용한다.

## 참여와 운영 권한

- 요청·동의는 유효한 Gateway session의 actor로 처리한다. 카카오 연결 ID와 인증
  완료 시각이 모두 있거나, 기존 계정 정책의 해당 profile에 유효한 특수 접근
  허용이 있어야 한다. 단순 인증 유예만 있는 계정은 참여하지 못한다.
- 로그인·게임 제재, 해당 서버의 접근 제한, 예약 탈퇴 계정은 참여하지 못한다.
  예약 전환 때 요청자와 동의자의 현재 자격을 다시 확인한다.
- 공개 목록은 로그인 사용자에게 제공한다. 요청자의 표시명, 요청 설정과 유효
  동의 수를 표시하고, 계정 ID·배포 source·내부 오류·동의자 목록은 공개하지 않는다.
- 해당 profile의 `admin.scenarios.reset` 권한자가 오프너로서 수락·거절한다.
  요청에서 파생한 예약에는 별도 deploy 권한이나 임의 시각 지정 권한을 부여하지
  않는다. 정책 저장은 `admin.profiles.settings` 권한이 필요하다. 기존 superuser
  판정과 profile scope 검사를 그대로 사용하며 운영 mutation은 감사 원장에 남긴다.

배포 이력이 있는 서버의 시나리오는 active build에서 읽는다. 아직 첫 build가 없는
닫힌 서버는 운영자가 설정한 releaseSource에서 시나리오를 읽어 첫 오픈도 요청할 수
있다. active build와 patch 정책이 모두 없으면 운영 설정 준비를 요구한다.

## 서버 정책

정책은 `GatewayProfile.meta.openRequestPolicy`에 저장한다. 요청 화면의 권한자용
`서버 오픈 요청 정책`에서 변경하며 변경 사유를 요구한다.

| key                    | 기본값 | 허용 범위 / 의미                                                    |
| ---------------------- | ------ | ------------------------------------------------------------------- |
| `enabled`              | `true` | 요청과 동의·수락 접수 여부                                          |
| `lifetimeDays`         | `7`    | 1~365일, 새 요청의 최대 모집 기간                                   |
| `buildLeadMinutes`     | `10`   | 1~10080분, 가오픈 이전 준비 시작 간격                               |
| `endorsementThreshold` | `null` | `null`이면 오프너 수락만, 1~10000이면 요청자 외 필요한 정식 동의 수 |

CHE를 포함해 별도 설정이 없는 모든 서버는 자동 예약을 사용하지 않으며, 목록에
동의 목표 숫자와 동의 버튼도 표시하지 않는다. 필요한 서버에서만 숫자를 설정한다.
기준을 낮추거나 자동 예약을 켜면 이미 모인 유효 동의도 즉시 평가한다. 여러 요청이
기준을 충족하면 생성 시각·ID 순서상 가장 오래된 유효 요청 하나가 예약된다.
예약 전환에 실패하면 정책 변경 transaction도 취소되어 부분 적용을 숨기지 않는다.

요청 모집은 생성 시각 + 모집 기간과 가오픈 - 준비 간격 중 이른 시각에 끝난다.
미래 가오픈에는 현재 시점부터 준비 간격 이상의 여유가 있어야 하고 정식 오픈은
가오픈보다 뒤여야 한다. 준비 간격을 늘리면 기존 대기 요청도 새 준비 시각이 지난
경우 즉시 만료로 판정한다. 모집 기간 변경은 새 요청에 적용하고, 이미 수락된
예약의 실행 시각과 patch source는 정책 변경으로 소급 변경하지 않는다.

## 저장·예약·실행

`GatewayOpenRequest`는 원본 설치 설정, 시나리오 표시 snapshot, 요청자, 기수
식별자, 만료·가오픈·오픈 시각과 결정 정보를 저장한다. `GatewayOpenEndorsement`는
(request, user) PK로 한 사람의 중복 동의를 막는다. 요청자는 자기 요청에 동의할
수 없다. 한 사람은 한 서버에 유효 대기 요청 하나만 둘 수 있으며, 수정하려면
철회 후 다시 제출한다. 같은 설정의 제출 재시도는 기존 요청 ID를 반환한다.

```text
PENDING -> RESERVED    오프너 수락 또는 유효 동의 기준 충족
        -> WITHDRAWN   요청자 철회
        -> REJECTED    오프너 거절
        -> SUPERSEDED  다른 요청 예약 / 서버 재오픈 / 기수 변경
        -> EXPIRED     모집 또는 준비 시작 시각 도달
```

목록과 mutation은 현재 시각·서버·기수를 기준으로 실효 상태를 판정한다. 만료된
행은 목록에서 즉시 빠지며 DB에서는 삭제하지 않는다. 다음 요청 접수 때 오래된
PENDING 행의 저장 상태도 정리한다. 서버별 유효 대기 요청은 최대 100개다.

수락·동의, 요청 상태와 연결 RESET 생성, 등록 로그와 나머지 대기 요청의 종료는
하나의 PostgreSQL transaction이다. 기존 operation admission/claim과 같은 advisory
lock을 먼저 잡고 profile row를 잠근다. 다른 활성 서버 작업이나 예약이 있으면
새 예약을 만들지 않는다. 수락 재시도와 수락·동의 경합도 RESET 하나만 만든다.

예약의 `scheduledAt`은 서버가 **가오픈 - buildLeadMinutes**로 계산한다. 요청자는
build 시각, branch, commit, actor ID를 지정할 수 없다. 수락 시 현재 서버의
`releaseSource`를 읽고 시나리오와 release build 호환성을 검증한다. BRANCH는 기존
RESET과 같이 실행 시점 branch head를 해석하여 고정하고 COMMIT은 고정 SHA를
사용한다. 기존 active workspace를 재사용할 수 있으면 build를 생략하며 migration과
seed는 예정된 준비 시각부터 진행한다. 예약 공지는 기존 `publicAnnouncement`
projection으로 즉시 공개된다. 대기 중 profile을 `RESERVED`로 바꾸지 않으며 기존
RESERVED의 build·migration·seed 완료 후 가오픈 대기 의미를 보존한다.

worker는 실행 진입, build 이후와 초기화 전 서버 상태·기수·정식 오픈 deadline을
다시 확인한다. 서버가 다시 열렸거나 기수가 바뀌었거나 정식 오픈까지 지나면 오래된
요청으로 게임을 초기화하지 않고 실패로 남긴다. build가 가오픈을 넘기면 기존 예약
공지의 지연 판정을 사용한다. 준비 실패·취소 상태는 요청 목록과 관리자 operation
이력에서 확인하며 기존 취소·lease·재시도 경로로 처리한다. 새 기수 게시 이후 실패는
오래된 예약의 재실행을 차단하므로 현 상태를 확인한 후 기존 운영 복구 경로를 쓴다.

## 주요 경계 사례

| 경우                                             | 결과                                                   |
| ------------------------------------------------ | ------------------------------------------------------ |
| COMPLETED / STOPPED / CANCELLED                  | 정식 사용자의 요청 허용                                |
| RUNNING / PREOPEN / PAUSED / RESERVED / DISABLED | 새 요청과 예약 전환 거부                               |
| 무인증·오래된 session·타 서버 오프너             | 거부, 요청·동의·operation mutation 없음                |
| 유예 계정·만료/타 서버 특수 허용·제재·탈퇴 예약  | 참여 거부                                              |
| 한 사람이 여러 session에서 동의                  | 같은 동의 한 개, 추가 가산 없음                        |
| 동의자 자격 회수                                 | 유효 숫자·자동 예약 집계에서 제외                      |
| 요청자 자격 회수                                 | 수락·자동 예약 전환 거부                               |
| 동시 임계 동의·동시 수락·서로 다른 요청 수락     | RESET 하나만 생성                                      |
| build source/시나리오 불일치·호환성 실패         | 예약 없음, 마지막 동의도 rollback; 수정 후 재시도 가능 |
| 이미 예약된 요청 철회                            | 거부; 오프너가 기존 서버 작업 취소 경로 사용           |
| DB/API 재시작·worker 재시작                      | DB 요청·고유 동의·기존 durable RESET/lease로 복구      |
| 오래된 예약과 새 게임 / 정식 오픈 deadline 경과  | worker가 초기화 전 거부                                |

## Migration과 검증

추가 migration은 `20261022000000_add_open_requests`이다. Gateway migration을 먼저
적용하고 API·orchestrator·frontend를 함께 갱신한다. additive 변경이므로 기존 계정과
예약을 변환하거나 삭제하지 않는다. downgrade할 때는 기존 community 예약을 먼저
확인하고 취소·처리한다. 구형 worker에는 새 기수/deadline 보호가 없기 때문이다.
DB rollback은 신규 테이블 삭제가 아니라 사전 backup/restore 절차를 따른다.

격리된 개발 DB/Redis instance에서 다음을 실행한다. URL은 환경으로 전달하고 실제
credential을 CLI argument나 log로 출력하지 않는다.

```sh
pnpm --filter @sammo-ts/infra prisma:migrate:deploy:gateway
pnpm --filter @sammo-ts/infra prisma:migrate:deploy:gateway
# OPEN_REQUEST_DATABASE_URL: 이 검증 전용 DB/schema
pnpm --filter @sammo-ts/infra verify:migration:open-requests
pnpm --filter @sammo-ts/gateway-api test openRequests.integration.test.ts
# 먼저 /gateway prefix의 production frontend를 build한 뒤 실제 HTTP+DB Chromium 검증
OPEN_REQUEST_BROWSER=1 pnpm --filter @sammo-ts/gateway-api test openRequests.integration.test.ts
PLAYWRIGHT_GATEWAY_FRONTEND_PORT=15272 pnpm --filter @sammo-ts/gateway-frontend exec playwright test open-suggestion.spec.ts --config e2e/playwright.config.mjs
```

Integration의 Git catalog/호환성 adapter는 fixture다. 실제 PostgreSQL, Fastify/tRPC,
session 검증, 요청·동의·수락과 operation persistence를 실행하고, 선택적으로 같은
서버에 production frontend와 실제 Chromium을 연결한다. screenshot·DOM·geometry와
computed style은 `test-results/open-request-live/`, UI fixture 결과는
`test-results/server-operations/`에 보존한다. fixture 성공은 운영 배포나 실제 외부
builder 실행의 증거가 아니다. 조건부 CI runner는 gateway_runtime 전용 schema에서
이 integration을 실행하며 browser는 별도 opt-in이다.
