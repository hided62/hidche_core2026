# 런타임 아키텍처

## 프로세스

| 프로세스             | 시작점                                                   | 책임                                        |
| -------------------- | -------------------------------------------------------- | ------------------------------------------- |
| gateway API          | `app/gateway-api/src/server.ts`                          | 계정, session, profile, admin operation     |
| gateway orchestrator | `app/gateway-api/src/orchestrator/orchestratorServer.ts` | DB queue, build, PM2 reconciliation         |
| release controller   | `app/release-controller/src/index.ts`                    | Gateway 전체 릴리스와 controller CLI 전환   |
| game frontend        | Vite preview                                             | profile별 commit frontend artifact          |
| game API             | `app/game-api/src/server.ts`                             | profile tRPC, SSE, worker transport         |
| turn daemon          | `app/game-engine/src/turn/cli.ts`                        | schedule, command, 월간 lifecycle, DB flush |
| battle worker        | `app/game-api/src/battleSim/worker.ts`                   | 격리된 전투 시뮬레이션                      |
| auction worker       | `app/game-api/src/auction/worker.ts`                     | 경매 timer와 낙찰 처리                      |
| tournament worker    | `app/game-api/src/tournament/worker.ts`                  | 대회 진행과 결과 처리                       |

Gateway API와 game API는 기본적으로 `0.0.0.0`에 bind합니다. 실제 port와
prefix는 환경 변수와 배포 profile이 결정합니다.

현재 PM2 조립에서 game profile 하나는 frontend, API, turn daemon, auction,
battle-sim, tournament worker의 여섯 process를 만듭니다. 각 정의에는
`instances`나 cluster `exec_mode`가 없으므로 모두 단일 fork입니다. frontend도
Caddy 정적 파일이 아니라 profile별 Vite preview Node process이고, API도 하나의
Fastify process입니다. worker 역할 분리는 API event loop의 작업을 줄이지만
frontend/API replica나 장애 대체 backend를 제공하지는 않습니다.

Profile은 PostgreSQL schema와 Redis namespace를 분리하지만 같은 database,
PostgreSQL instance, runtime cgroup을 공유합니다. 현재 `PrismaPg` adapter에는
role별 pool 상한을 명시하지 않아 각 DB 사용 process가 `pg` 기본 pool 상한을
독립적으로 가질 수 있습니다. 따라서 profile 수를 늘릴 때는 process RSS뿐 아니라
API, daemon, 세 worker와 Gateway 계열의 합산 connection budget을 PostgreSQL
`max_connections` 안에서 먼저 정해야 합니다.

## Gateway 실행

`resolveGatewayApiConfigFromEnv()`가 PostgreSQL schema, Redis prefix, session
TTL, game-token secret, OAuth, local-account 정책과 orchestrator 설정을
검증합니다.

Gateway API는 다음 저장 경계를 사용합니다.

- `AppUser`, `SystemSetting`: 계정과 정책
- `SpecialAccountAccessGrant`: Kakao 없는 테스트·복구·기타 계정의 profile 범위, 만료, 장수 생성 및 해제 이력
- `GatewayProfile`: profile, scenario, port, 상태와 build 결과
- `GatewayOperation`: build/reset/open/close 등 실행 요청과 결과
- `GatewayReleaseOperation`, `GatewayReleaseState`: Gateway 전체 릴리스 queue와 현재·이전 commit
- `GatewayRuntimeAction`: profile별 시간 가속·연기와 현재 기수 설정 변경 요청,
  payload, 부분 적용과 최종 결과
- Redis: gateway session, OAuth 임시 상태, KakaoTalk 로그인 challenge, flush channel

Kakao 로그인은 URL 이름만으로 사용자를 연결하지 않습니다. `account_email`과
`talk_message` scope를 항상 요청하고 callback의 `/v2/user/me` 응답에서 고유 ID,
이메일 보유·유효·인증 상태를 확인합니다. 기존 Kakao 계정이면 stable OAuth ID로
사용자를 찾은 뒤 이메일과 갱신된 token metadata를 함께 저장합니다. stable ID가
로컬에 없지만 같은 `AppUser.email` 소유자가 있으면 일회용 OAuth session에 대상
사용자 ID를 묶고 `account_recovery/link_existing` 선택을 반환합니다. 사용자가
확인한 경우에만 그 행의 Kakao ID와 token metadata를 교체하며, 과거
`kakaoTalkVerifiedUntil`은 무효화하여 새 KakaoTalk OTP를 통과하기 전에는 login
session을 발급하지 않습니다. 확인과 저장 사이에 email 또는 OAuth 소유자가
바뀌면 다시 시작하도록 거부합니다.

Kakao `/v1/user/signup`이 HTTP non-2xx의 `code=-102`,
`msg=already registered`를 반환하면 transport 계층에서 예외 대신 복구 신호로
정규화합니다. 다른 non-2xx signup 오류는 계속 실패합니다. stable ID와 email
소유자가 모두 없으면 `account_recovery/rejoin`을 반환합니다. 사용자가 재가입을
확인해야 별도의 `register` intent session을 발급하므로 기존 가입 mutation으로
확인 단계를 우회할 수 없습니다. 반대로 provider 연결이 이번 요청에서 새로
생성됐고 로컬 email 소유자도 없으면 바로 신규 가입 form으로 진행합니다. 이미
로컬 stable ID가 있는 상태에서 현재 이메일이 다른 `AppUser`에 속하면 identity를
이메일 계정으로 옮기지 않고 기존처럼 `CONFLICT`로 끝냅니다.

일반 비밀번호 로그인도 `oauth_type=KAKAO`이면 저장 access token을 사용하고,
필요하면 아직 유효한 refresh token으로 갱신한 뒤 `/v2/user/me`를 호출합니다.
provider ID가 저장 `oauth_id`와 다르면 session을 발급하지 않고, 확인된 이메일은
unique constraint 아래에서 동기화합니다. provider나 refresh 호출 실패는 Kakao
재로그인을 요구하며 저장된 identity를 임의로 바꾸지 않습니다.

`AppUser.kakaoTalkVerifiedUntil`이 지났으면 Gateway는 4자리 코드를 생성해 Kakao
“나와의 채팅”에 한 번 보내고 Redis에 사용자별 180초 challenge를 둡니다. 유효한
challenge는 재로그인에서도 재사용하여 중복 메시지를 보내지 않습니다. 제출은
Redis script가 원자적으로 성공 소비 또는 실패 횟수 차감(최대 3회)을 수행합니다.
성공하면 유효 기한을 10일 뒤로 저장한 후에만 Gateway session을 만듭니다.
challenge와 OAuth pending state에는 TTL이 있으며 Redis 장애나 메시지 발송 실패는
로그인 실패로 끝납니다.

Kakao 없는 게임 접근은 Gateway에서만 판정합니다. 비밀번호와 제재를 먼저 검사한 뒤
운영자 또는 유효한 특수 grant가 있는 기존 Kakao 연결 계정은 공급자 호출 없이
Gateway session을 발급합니다. 게임 profile 진입에서는 다시 제재 검사를 수행하고
Kakao 확인, 운영자 role, 유효한 `SpecialAccountAccessGrant`, 기존 일반 계정 유예
순으로 접근과 장수 생성 가능 여부를 계산합니다. grant의 빈 `profiles`는 전체,
base profile(`che`)은 모든 기수, profile name(`che:2`)은 정확한 기수를 뜻합니다.
결과는 AES-256-GCM game token의 `identity.specialAccess`와
`identity.canCreateGeneral`에 서명되어 game API가 장수 생성 mutation 전에 다시
검사합니다. grant 사유나 부여자 정보는 game token에 넣지 않습니다.

Orchestrator는 `GatewayOperation`을 claim하고 source ref를 commit으로
해결합니다. `WorkspaceManager`가 commit별 worktree를 준비하고 build runner가
artifact를 만들며 `Pm2ProcessManager`가 profile process를 조정합니다.
재시작 시 DB 상태와 process 상태를 reconciliation합니다.

Profile `DEPLOY` operation은 현재 game schema와 시즌 데이터를 유지한 채 선택
commit의 game API, engine과 profile 전용 frontend artifact를 빌드합니다. 기존
프로세스를 멈춘 뒤 `prisma migrate deploy`만 실행하고 seed는 호출하지 않습니다.
새 API·frontend와 모든 worker가 PM2 `online`이고 HTTP readiness가 성공해야
build commit을 게시합니다. 실패하면 이전 worktree 프로세스를 다시 시작합니다.
`RESET` operation은 같은 build 경계를 사용한 뒤 현재 시즌 테이블을 seed로
교체합니다. Seeder의 reset 목록에는 `hall`, `ng_games`, `yearbook_history`,
과거 장수·국가와 상속·진단 자료가 포함되지 않습니다.

시간 가속·연기는 일반 profile meta log가 아니라 UUID가 있는
`GatewayRuntimeAction`으로 접수합니다. Profile별 `REQUESTED`/`PARTIAL`은
DB partial unique index로 한 건만 허용합니다. Turn daemon은 자신의 lease를
확인한 뒤 action ID로 결정적인 `InputEvent`를 만들고, world·전 장수·OPEN
경매는 같은 PostgreSQL transaction에서, checkpoint는 이를 감싼 동일
`EngineStateManager` snapshot 경계에서 이동합니다. Commit 뒤
경매 timer와 활성 토너먼트 시각을 Redis에 idempotent하게 투영합니다.
Redis 단계가 실패하면 action은 `PARTIAL`과 backoff 상태로 남고 DB 시간은
다시 이동하지 않습니다.

현재 기수의 턴 간격·장수 생성 제한·유저 자동턴도 같은
`GatewayRuntimeAction`/`InputEvent` 경계를 사용합니다. Turn daemon은 세 값을
한 transaction에서 `world_state.config`와 `meta`에 저장합니다. 턴 간격이
바뀌면 현재 표시 게임 시각과 game tick을 고정한 채 `clock_base_time`, 장수
턴·최근 전쟁, checkpoint, 경매·메시지·설문 DateTime 투영값을 새 간격으로
다시 계산합니다. 기존 `log_entry.created_at`은 갱신하지 않고 변경을 알리는 새
역사 로그만 추가합니다. Redis 토너먼트의 tick 소유 시각도 action ID로 한 번만
재투영하며 실패하면 `PARTIAL`에서 재시도합니다.

Gateway API와 독립 orchestrator의 SIGINT·SIGTERM은
`installGatewayShutdownController()`가 하나의 종료 Promise로 합칩니다.
Gateway API는 Fastify `app.close()`를 통해 orchestrator task를 drain한 뒤
Redis와 PostgreSQL을 닫습니다. 독립 orchestrator도 task drain 뒤 PostgreSQL을
한 번만 닫습니다. 반복 signal, 종료 완료 뒤 재호출과 close 실패에서도 첫
reason만 소유하고 등록한 signal listener를 해제합니다.

## Game API 실행

`resolveGameApiConfigFromEnv()`가 `PROFILE`, `SCENARIO`,
`GAME_PROFILE_NAME`, API·SSE·upload 경로와 worker timeout을 결정합니다.
기본 profile name은 `${profile}:${scenario}`입니다.

Fastify server는 요청에서 game token을 검증해 `GameApiContext.auth`에
넣습니다. Router는 public procedure와 인증 procedure를 구분하고, 변경
대상 장수·국가·archive owner를 session actor와 DB에서 해석합니다.

Mutation은 두 형태입니다.

- API transaction으로 끝나는 mutation은 `executeInputEvent()`가
  `target=API` event를 만들고 결과와 event 상태를 같은 transaction에서
  commit합니다.
- turn world가 필요한 mutation은 daemon transport가 `target=DAEMON`
  event를 만들고 turn daemon의 처리 대상으로 전달합니다.

같은 `requestId`의 완료·처리 중 event는 중복 수락하지 않습니다. 실패 event는
claim 가능한 상태에서 attempts를 증가시켜 재처리합니다.

## Turn daemon 조립

`createTurnDaemonRuntime()`은 다음 순서로 런타임을 구성합니다.

1. `DatabaseTurnDaemonLease`가 profile lease와 fencing token을 확보합니다.
2. `loadTurnWorldFromDatabase()`가 world, 장수, 국가, 도시, 외교, 예약 턴,
   event와 resource snapshot을 읽습니다.
3. scenario, map, unit set과 command profile을 적재합니다.
4. action-module bundle, AI, command registry, 월간 event action을 조립합니다.
5. `EngineStateManager`가 in-memory mutation과 transaction flush를 묶습니다.
6. `TurnDaemonLifecycle`이 control queue와 schedule을 실행합니다.

Lifecycle은 가장 빠른 장수 턴과 다음 tick 중 앞선 시각을 선택합니다.
pause gate, 수동 run, shutdown과 budget을 같은 loop에서 처리합니다.

## 한 번의 실행과 저장

```text
lease/fencing 확인
  -> input_event claim
  -> in-memory command 또는 calendar action
  -> world dirty state와 side effect 수집
  -> EngineStateManager transaction
       -> world/general/nation/city/turn/log flush
       -> input_event result/status 갱신
       -> in-memory world checkpoint 갱신
  -> commit
  -> realtime 알림
```

Transaction 실패 시 in-memory snapshot을 복원하고 event는 재시도 가능한 실패
상태로 남깁니다. Lease 소유권을 잃은 daemon은 flush를 확정하지 않습니다.
Checkpoint의 단일 소유자는 `InMemoryTurnWorld`이며 state store는 이를
위임 조회합니다. 별도 checkpoint 복사본이 snapshot보다 앞서 나가지 않습니다.

예약 턴은 revision/CAS와 lease를 사용합니다. API의 편집과 daemon의 실행이
경합해도 오래된 revision이 새 queue를 덮어쓰지 않게 합니다.

정상 gameplay 경로는 table 전체를 배타 잠그지 않습니다. 서로 다른 profile
schema의 row lock은 직접 충돌하지 않지만 다음 직렬화 지점은 남습니다.

- daemon flush마다 profile별 `turn_daemon_lease`와 단일 `world_state` 행을 갱신합니다.
- `read_model_revision`의 전역 entity와 input-event revision/CAS는 같은 profile에서 hot row가 될 수 있습니다.
- outbox dispatcher는 `FOR UPDATE SKIP LOCKED`로 claim 경쟁을 분산합니다.
- 경매, 베팅, 메시지, 장수 선택·생성은 대상 row lock 또는 advisory lock을 사용합니다.
- PostgreSQL advisory lock은 schema가 아니라 database 범위입니다. key에 profile/schema를 포함하지 않은 일부
  기능별 lock은 서로 다른 profile 사이에서도 같은 key일 때 잠깐 직렬화될 수 있습니다.

월 경계 flush는 dirty world, 장수·국가·도시, 로그와 outbox를 한 transaction에
저장하므로 일반 장수 1턴보다 lock 보유 시간이 깁니다. profile별 월 경계 시각이
겹치면 row 자체는 달라도 PostgreSQL CPU/I/O, connection과 runtime memory에서
경합합니다. Migration과 `RESET`의 강한 lock은 일반 운영 중 실행하지 않고
orchestrator의 process 정지·배포 경계에서 다룹니다.

## 월간 경계

Calendar handler는 turn time이 월 경계를 지날 때 scenario event table의
action을 순서대로 실행합니다. Core event, 수입, 국가 등급, NPC, 이민족,
도시 공급, 전쟁 수입, 특기, 유니크·유산, 베팅, 통일·연감 처리는
`app/game-engine/src/turn/monthly*.ts`, `calendarHandlers.ts`,
`unificationHandler.ts`, `yearbookHandler.ts`에서 조립됩니다.

Action 순서, RNG 소비와 persistence 순서는 ref 호환 계약입니다. 새 handler는
event catalog, in-memory state, dirty marking, flush와 reload 검증까지
연결합니다.

## 장애 경계

- PostgreSQL은 gameplay mutation과 daemon 소유권의 기준입니다.
- Redis pub/sub, SSE와 flush notification은 commit 이후 best-effort입니다.
- Worker timeout은 요청 실패로 반환하며 DB commit 여부를 별도로 확인합니다.
- API·daemon process 재시작은 `InputEvent`, lease, checkpoint와 operation
  상태에서 이어집니다.
- 운영 process와 외부 Caddy 상태는 local build·mock E2E로 증명되지 않습니다.

## Build와 배포

Gateway operation은 source commit, worktree, build artifact와 process를
연결합니다. `tools/build-scripts/build-server.mjs`는 profile resource 복사만
담당합니다.

Gateway API·frontend·orchestrator 자신을 Gateway orchestrator가 교체하면
작업 중인 실행자가 사라질 수 있습니다. 따라서 `app/release-controller`가
별도 PM2 process로 `GatewayReleaseOperation`을 claim합니다. 선택 worktree의
`release-manifest.json`에서 controller protocol, component와 gateway/game
migration head를 확인하고 build와 gateway migration을 마친 뒤 Gateway 세
process를 전환합니다. HTTP와 PM2 readiness 실패 시 이전 Gateway worktree를
복구하고 성공한 경우에만 `GatewayReleaseState`의 현재·이전 commit을 바꿉니다.
Controller 자체 갱신은 별도 CLI process의 `self-upgrade` 명령이 수행합니다.

외부 공개 경로는 `/gateway/`, `/che/`, `/hwe/`입니다. frontend base,
tRPC, SSE, upload와 direct navigation은 해당 prefix를 유지합니다.
`/image/*`는 Caddy의 별도 파일 시스템 경로입니다.

Game과 gateway가 같은 PostgreSQL database/schema를 사용할 때 migration은
반드시 game 다음 gateway 순서로 적용합니다. 두 migration history는 하나의
`_prisma_migrations`를 공유하므로 새 migration directory 이름은 양쪽을
통틀어 고유해야 합니다. 과거 양쪽의
`20260727000000_add_legacy_migration_archive` 이름 충돌은 checksum을 바꾸지
않고 별도의 idempotent reconciliation migration으로 보정합니다.
