# 런타임 아키텍처

## 프로세스

| 프로세스             | 시작점                                                   | 책임                                        |
| -------------------- | -------------------------------------------------------- | ------------------------------------------- |
| gateway API          | `app/gateway-api/src/server.ts`                          | 계정, session, profile, admin operation     |
| gateway orchestrator | `app/gateway-api/src/orchestrator/orchestratorServer.ts` | DB queue, build, PM2 reconciliation         |
| game API             | `app/game-api/src/server.ts`                             | profile tRPC, SSE, worker transport         |
| turn daemon          | `app/game-engine/src/turn/cli.ts`                        | schedule, command, 월간 lifecycle, DB flush |
| battle worker        | `app/game-api/src/battleSim/worker.ts`                   | 격리된 전투 시뮬레이션                      |
| auction worker       | `app/game-api/src/auction/worker.ts`                     | 경매 timer와 낙찰 처리                      |
| tournament worker    | `app/game-api/src/tournament/worker.ts`                  | 대회 진행과 결과 처리                       |

Gateway API와 game API는 기본적으로 `0.0.0.0`에 bind합니다. 실제 port와
prefix는 환경 변수와 배포 profile이 결정합니다.

## Gateway 실행

`resolveGatewayApiConfigFromEnv()`가 PostgreSQL schema, Redis prefix, session
TTL, game-token secret, OAuth, local-account 정책과 orchestrator 설정을
검증합니다.

Gateway API는 다음 저장 경계를 사용합니다.

- `AppUser`, `SystemSetting`: 계정과 정책
- `GatewayProfile`: profile, scenario, port, 상태와 build 결과
- `GatewayOperation`: build/reset/open/close 등 실행 요청과 결과
- `GatewayRuntimeAction`: profile별 시간 가속·연기 요청, 부분 적용과 최종 결과
- Redis: gateway session, OAuth 임시 상태, flush channel

Orchestrator는 `GatewayOperation`을 claim하고 source ref를 commit으로
해결합니다. `WorkspaceManager`가 commit별 worktree를 준비하고 build runner가
artifact를 만들며 `Pm2ProcessManager`가 profile process를 조정합니다.
재시작 시 DB 상태와 process 상태를 reconciliation합니다.

시간 가속·연기는 일반 profile meta log가 아니라 UUID가 있는
`GatewayRuntimeAction`으로 접수합니다. Profile별 `REQUESTED`/`PARTIAL`은
DB partial unique index로 한 건만 허용합니다. Turn daemon은 자신의 lease를
확인한 뒤 action ID로 결정적인 `InputEvent`를 만들고, world·전 장수·OPEN
경매는 같은 PostgreSQL transaction에서, checkpoint는 이를 감싼 동일
`EngineStateManager` snapshot 경계에서 이동합니다. Commit 뒤
경매 timer와 활성 토너먼트 시각을 Redis에 idempotent하게 투영합니다.
Redis 단계가 실패하면 action은 `PARTIAL`과 backoff 상태로 남고 DB 시간은
다시 이동하지 않습니다.

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

외부 공개 경로는 `/gateway/`, `/che/`, `/hwe/`입니다. frontend base,
tRPC, SSE, upload와 direct navigation은 해당 prefix를 유지합니다.
`/image/*`는 Caddy의 별도 파일 시스템 경로입니다.

Game과 gateway가 같은 PostgreSQL database/schema를 사용할 때 migration은
반드시 game 다음 gateway 순서로 적용합니다. 두 migration history는 하나의
`_prisma_migrations`를 공유하므로 새 migration directory 이름은 양쪽을
통틀어 고유해야 합니다. 과거 양쪽의
`20260727000000_add_legacy_migration_archive` 이름 충돌은 checksum을 바꾸지
않고 별도의 idempotent reconciliation migration으로 보정합니다.
