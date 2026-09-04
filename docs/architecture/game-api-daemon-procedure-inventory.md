# game-api 턴 데몬 procedure/transaction inventory

## 범위와 판정 기준

`app/game-api/src/router/**`의 mutation에서 직접 또는 router 전용 helper를 거쳐
`ctx.turnDaemon.requestCommand()`를 호출하는 **49개 route**를 조사했다. 하나의 route가
여러 command를 보내더라도 route는 한 번만 세었다.

`authedProcedure`, `accessAuthedProcedure`, `accessAuthedInputProcedure`는 mutation일 때
`app/game-api/src/trpc.ts:61-104`, `:168-180`, `:215-221`의 API `input_event`
transaction을 만든다. `engineAuthedProcedure`, `accessEngineAuthedProcedure`,
`accessEngineAuthedInputProcedure`는 인증/접속 계측만 수행하며 API outer transaction을
만들지 않는다(`app/game-api/src/trpc.ts:182-192`, `:222-227`).

판정은 다음과 같다.

- **ENGINE 전환**: API는 actor/입력과 조기 오류를 읽을 뿐 durable DB 변경은 ENGINE
  transaction이 소유하고, ENGINE handler가 mutation 직전 mutable state를 다시 검증한다.
- **혼합/saga 필요**: API DB write, Redis 원본 상태, 보상 명령 또는 API snapshot에서만
  수행하는 권한/값 합성이 ENGINE 변경과 결합한다. durable saga 없이는 단일 transaction으로
  오인하지 않으며, ENGINE 완료를 기다리는 route는 API outer transaction을 열지 않는다.
- **기존 ENGINE**: 이 inventory의 기존 기준선에서 이미 ENGINE procedure였고 API
  outer input event가 없었다.
- **ENGINE 소유 + 불필요한 API outer**: gameplay durable mutation은 ENGINE이 전부
  소유하지만 route가 아직 API `input_event`/journal transaction에 감싸여 있다.

현재 합계는 **ENGINE 전환 36 + 혼합 3 + 기존 ENGINE 9 + 불필요한 API
outer 1 = 49**다.

ENGINE 전환 route의 explicit `requestId`는 각 route가 기존에 사용하던 HTTP 요청
또는 user/client-scoped durable identity를 유지한다. `inheritanceAction`은
`<http request id>:inherit.<action>:engine:0:inheritanceAction`을 사용하고,
`join.getSelectionPool`은 `select-pool:<user>:<http request id>:reserve`를 사용한다.
selection-pool create/reselect는 client request ID가 있을 때
`select-pool:<user>:<client request id>:<operation>`을, 없을 때 HTTP request/path identity를 사용한다
(`app/game-api/src/router/join/index.ts:75-91`).

## ENGINE procedure로 전환된 route

| route | 현재 procedure / API-side 작업 | ENGINE 소유 근거 |
| --- | --- | --- |
| `general.vacation`, `general.setMySetting`, `general.dropItem` | `engineAuthedProcedure`/`accessEngineAuthedInputProcedure`; session-owned general 조회만 수행 (`app/game-api/src/router/general/index.ts:767-815`) | ENGINE이 general 존재, 현재 설정과 item 보유를 다시 검증하고 변경 (`app/game-engine/src/turn/worldCommandHandler.ts:1712-1841`) |
| `nation.appoint`, `nation.changePermission`, `nation.kick` | `engineAuthedProcedure`; session actor 조회만 수행 (`app/game-api/src/router/nation/endpoints/appoint.ts:7-32`, `changePermission.ts:7-35`, `kick.ts:7-24`) | ENGINE이 actor 직위, 국가, 대상/도시를 다시 검증 (`app/game-engine/src/turn/worldCommandHandler.ts:1894-2291`) |
| `troop.create`, `troop.join`, `troop.exit`, `troop.kick`, `troop.rename` | `engineAuthedProcedure`; actor 및 조기 권한/대상 조회, API DB write 없음 (`app/game-api/src/router/troop/index.ts:429-577`) | membership/leader/nation/name 검증과 mutation을 ENGINE이 소유 (`app/game-engine/src/turn/worldCommandHandler.ts:1131-1430`) |
| `auction.openBuyRice`, `auction.openSellRice`, `auction.openUnique`, `auction.bidBuyRice`, `auction.bidSellRice`, `auction.bidUnique` | `engineAuthedProcedure`; auction/general/world 조기 validation과 commit 뒤 Redis timer index 갱신 (`app/game-api/src/router/auction/index.ts:337-662`) | open/bid DB mutation과 경합/resource 재검증은 ENGINE transaction (`app/game-engine/src/turn/worldCommandHandler.ts:1859-1885`, `app/game-engine/src/auction/bidder.ts`). Redis zset은 durable auction row에서 재구성하는 scheduler index다. |
| `inherit.openUniqueAuction` | `engineAuthedProcedure`; world/general/minimum bid 조기 validation (`app/game-api/src/router/inherit/index.ts:389-428`) | 공통 `auctionOpen` ENGINE handler가 mutation을 소유하고 API는 Redis timer index만 갱신 (`app/game-api/src/auction/open.ts:22-51`) |
| `join.getSelectionPool` | `engineAuthedProcedure`; actor와 accepted game time만 전달 (`app/game-api/src/router/join/index.ts:390-406`) | `selectPoolReserve` ENGINE handler가 world/DB 상태에서 예약을 재검증하고 저장 (`app/game-engine/src/turn/worldCommandHandler.ts:401-437`) |
| `inherit.buyHiddenBuff`, `inherit.setNextSpecialWar`, `inherit.resetSpecialWar`, `inherit.resetTurnTime`, `inherit.resetStat`, `inherit.buyRandomUnique`, `inherit.checkOwner` | 모두 `engineAuthedProcedure`; 인증 user ID와 action 입력만 전달 (`app/game-api/src/router/inherit/index.ts:107-124`, `:301-388`, `:429-445`) | `inheritanceAction` ENGINE handler가 general/user 소유권, 통일 상태, 잔액, 대상, RNG, general patch, inheritance point/log/message를 한 transaction에서 처리 (`app/game-engine/src/turn/worldCommandHandler.ts:807-818`, `app/game-engine/src/turn/inheritanceActionService.ts:313-669`) |
| `nation.setNotice`, `nation.setScoutMsg`, `nation.setSecretLimit`, `nation.setRate`, `nation.setBlockWar`, `nation.setBill`, `nation.setBlockScout` | `engineAuthedProcedure`; API는 인증 actor, 현재 국가와 조기 권한만 읽고 semantic mutation을 전달 (`app/game-api/src/router/nation/endpoints/setNotice.ts`, `setScoutMsg.ts`, `setSecretLimit.ts`, `setRate.ts`, `setBlockWar.ts`, `setBill.ts`, `setBlockScout.ts`) | `setNationSetting`이 실행 시점 owner/nation/직책·permission을 다시 검사한다. 전쟁 설정 잔여 횟수 차감과 임관 잠금 검사를 현재 ENGINE state에서 수행하고, 공지는 logical game time과 author snapshot을 국가 meta와 같은 transaction에 저장한다 (`app/game-engine/src/turn/nationSettingMutation.ts`, `worldCommandHandler.ts`). |
| `npc.setNationPolicy`, `npc.setNationPriority`, `npc.setGeneralPriority` | `accessEngineAuthedInputProcedure`; API는 현재 화면값과 unit-set 기반 입력 보조만 수행하고 actor-bound semantic delta와 명시적 nullable revision을 전달 (`app/game-api/src/router/npc/index.ts`) | `setNpcPolicy`가 실행 시점 owner/nation/permission, strict CAS, 현재 troop/city membership, priority와 numeric policy를 검증하고 logical setter snapshot과 delta만 반영한다 (`app/game-engine/src/turn/npcPolicyMutation.ts`, `worldCommandHandler.ts`). |

합계 **36개 route**다.

## 혼합 또는 validation 이관이 먼저 필요한 route

| route | 현재 procedure / outer transaction | 보류 근거 |
| --- | --- | --- |
| `messages.respond` | `authedProcedure`, action별 분기 (`app/game-api/src/router/messages/index.ts:318-372`) | `scout`/`raiseInvader`는 `messageRespond` ENGINE command가 처리하지만 `noAggression`/`cancelNA`/`stopWar`는 API transaction의 `respondToDiplomaticMessage` 경로가 처리한다. route 전체를 ENGINE-owned로 보지 않는다. |
| `tournament.join`, `tournament.placeBet` | `engineAuthedProcedure`, API outer 없음 (`app/game-api/src/router/tournament/index.ts`) | PostgreSQL ENGINE resource/meta 명령과 Redis-owned participants/bets를 결합하고 실패 시 보상 ENGINE 명령을 보낸다. API clock advisory lock을 잡은 채 child ENGINE transaction을 기다리지 않으며, command에는 HTTP request-scoped step ID를 전달한다. 여전히 하나의 DB transaction이 아니므로 durable saga/reconciliation이 필요하다. |

합계 **3개 route**다.

## 기존에 API outer transaction이 없던 ENGINE route

| route | 근거 |
| --- | --- |
| `general.adjustIcon` | `engineAuthedProcedure`; helper가 stable account-icon request ID로 ENGINE command를 보냄 (`app/game-api/src/router/general/index.ts:694-720`, `app/game-api/src/services/accountIconSync.ts:40-75`) |
| `general.ensureDieOnPrestartStatus`, `general.dieOnPrestart`, `general.buildNationCandidate`, `general.instantRetreat` | `accessEngineAuthedProcedure`/`accessEngineAuthedInputProcedure`; user/general 조회는 outer transaction 밖이고 command마다 stable request ID가 있음 (`app/game-api/src/router/general/index.ts:104-144`, `:722-766`) |
| `join.selectPoolGeneral`, `join.reselectPoolGeneral`, `join.createGeneral`, `join.possessGeneral` | `engineAuthedProcedure`; client request ID가 있으면 user-scoped durable identity를 사용 (`app/game-api/src/router/join/index.ts:407-564`, `:608-642`) |

합계 **9개 route**다.

## ENGINE이 소유하지만 API outer transaction이 남은 route

| route | 현재 상태 | 남은 일 |
| --- | --- | --- |
| `vote.submitVote` | `authedProcedure`가 API outer `input_event` transaction을 만든다. API는 poll/actor 조기 validation 후 `voteReward`를 보내고 `front.general` journal을 표시한다 (`app/game-api/src/router/vote/index.ts:294-369`). ENGINE은 poll row lock, 선택 validation, vote insert, reward/idempotency marker, 금·아이템·로그 변경을 한 mutation transaction에서 소유한다 (`app/game-engine/src/turn/worldCommandHandler.ts:2430-2847`). | viewer-specific `front.general` invalidation을 ENGINE commit journal로 옮기고, 현재 middleware가 만드는 `voteReward` child identity를 explicit request ID로 보존한 뒤 ENGINE procedure로 전환한다. |

합계 **1개 route**다. Gameplay DB mutation 소유권 기준으로는 불필요한 outer이지만,
`front.general` journal이 API에 남아 있으므로 procedure만 바꾸면 실시간 갱신 계약을 잃는다.

## 검증 계약

- `app/game-api/test/inGameMenuPermissions.test.ts`: converted access-engine route가 mock
  `$transaction`을 호출하지 않고 기존 형식의 stable ENGINE request ID를 전달한다.
- `app/game-api/test/nationPersonnelRouter.test.ts`: nation personnel route의 동일 계약을
  검증한다.
- `app/game-api/test/nationSettingRouter.test.ts`, `nationHtmlRouter.test.ts`,
  `scoutBlockRouter.test.ts`: 일곱 국가 설정이 API outer transaction 없이 인증 actor와
  semantic intent를 전달하고 ENGINE 거절을 그대로 매핑하는지 검증한다.
- `app/game-api/test/npcPolicyRouter.test.ts`,
  `app/game-engine/test/npcPolicyLifecycle.test.ts`: NPC policy의 명시적 nullable CAS,
  실행 시점 권한과 delta merge/replay 경계를 검증한다.
- `app/game-api/test/troopRouter.test.ts`: troop mutation의 동일 계약을 검증한다.
- `app/game-api/test/auctionRouter.test.ts`: auction mutation이 API transaction 없이
  daemon command와 Redis timer projection을 완료하는 계약을 검증한다.
- `app/game-api/test/tournamentRouter.test.ts`: 참가·베팅이 API transaction을 열지 않고
  request-scoped ENGINE command ID와 Redis mutation lock을 사용하는지 검증한다.
- `app/game-api/test/inheritRouter.test.ts`,
  `app/game-engine/test/inheritanceActionPersistence.integration.test.ts`: 인증 actor, point/log,
  general/message 변경이 `inheritanceAction` ENGINE transaction에 함께 있는지 검증한다.
- `app/game-api/test/voteRouter.test.ts`, `app/game-engine/test/voteReward.test.ts`: API 조기
  validation과 ENGINE의 vote insert/reward/idempotency 경계를 검증한다. API outer/journal
  제거는 아직 검증 대상이 아니다.
- raw inventory 재검색: `rg -n "requestCommand\\(" app/game-api/src/router`와
  `openAuctionWithDaemon`, `requestInheritanceAction`, `updateNationSetting`,
  `requestNpcPolicyMutation`,
  `adjustAccountIconForUser`, `requestImmediateAction`, `requestJoinCreateCommand`,
  `requestNpcPossessionCommand` caller 검색을 함께 실행해 helper 경유 route를 놓치지
  않는다.
