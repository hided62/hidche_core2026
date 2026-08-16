# game-api 턴 데몬 procedure/transaction inventory

## 범위와 판정 기준

`app/game-api/src/router/**`의 mutation에서 직접 또는 router 전용 helper를 거쳐
`ctx.turnDaemon.requestCommand()`를 호출하는 46개 route를 조사했다. `authedProcedure`,
`accessAuthedProcedure`, `accessAuthedInputProcedure`는 mutation일 때
`app/game-api/src/trpc.ts:42-75`의 API `input_event` transaction을 만든다.
`engineAuthedProcedure`, `accessEngineAuthedProcedure`,
`accessEngineAuthedInputProcedure`는 인증/접속 계측만 수행하며 API outer transaction을
만들지 않는다(`app/game-api/src/trpc.ts:150-175`).

판정은 다음과 같다.

- **ENGINE 전환**: API는 actor/입력과 조기 오류를 읽을 뿐 durable DB 변경은 ENGINE
  transaction이 소유하고, ENGINE handler가 mutation 직전 mutable state를 다시 검증한다.
- **혼합/saga 필요**: API DB write, Redis 원본 상태, 보상 명령 또는 API snapshot에서만
  수행하는 권한/값 합성이 ENGINE 변경과 결합한다. procedure만 바꾸지 않는다.
- **기존 정상**: 이미 ENGINE procedure이고 API outer input event가 없다.

ENGINE 전환 route의 명시적 `requestId`는 기존 middleware가 만든 child identity
`<http request id>:<trpc path>:engine:0:<command type>`를 유지한다. 따라서 deploy 전후
동일 HTTP request identity의 ENGINE event가 달라지지 않는다.

## 이번에 ENGINE procedure로 전환

| route | 이전 outer transaction | API-side 작업 | ENGINE 소유 근거 |
| --- | --- | --- | --- |
| `general.vacation`, `general.setMySetting`, `general.dropItem` | 있음 | session-owned general 조회만 수행 | route `app/game-api/src/router/general/index.ts:657-706`; ENGINE이 general 존재/현재 설정/보유 item을 다시 검사하고 변경 `app/game-engine/src/turn/worldCommandHandler.ts:1476`, `:1514`, `:1571` |
| `nation.appoint`, `nation.changePermission`, `nation.kick` | 있음 | session actor 조회만 수행 | route `app/game-api/src/router/nation/endpoints/appoint.ts:7`, `changePermission.ts:7`, `kick.ts:7`; ENGINE이 actor 직위, 국가, 대상/도시를 다시 검사 `app/game-engine/src/turn/worldCommandHandler.ts:1648`, `:1718`, `:1888` |
| `troop.create`, `troop.join`, `troop.exit`, `troop.kick`, `troop.rename` | 있음 | actor 및 조기 권한/대상 조회; API DB write 없음 | route `app/game-api/src/router/troop/index.ts:165-314`; 동일 membership/leader/nation/name 검증과 mutation은 ENGINE `app/game-engine/src/turn/worldCommandHandler.ts:924`, `:1012`, `:1079`, `:1128`, `:1180` |
| `auction.openBuyRice`, `auction.openSellRice`, `auction.openUnique`, `auction.bidBuyRice`, `auction.bidSellRice`, `auction.bidUnique` | 있음 | auction/general/world 조기 validation; commit 뒤 Redis timer index 갱신 | route `app/game-api/src/router/auction/index.ts:325-649`; auction open/bid DB mutation과 경합/resource 재검증은 ENGINE transaction `app/game-engine/src/turn/worldCommandHandler.ts:1613`, `app/game-engine/src/auction/bidder.ts:183-550`. Redis zset은 durable auction row에서 재구성 가능한 scheduler index이며 API DB transaction의 일부가 아니었다. |
| `inherit.openUniqueAuction` | 있음 | world/general/minimum bid 조기 validation; inheritance point 차감 없음 | route `app/game-api/src/router/inherit/index.ts:794-835`; 공통 `auctionOpen` ENGINE handler와 Redis timer index만 사용 |

합계 18개 route다. 모든 전환은 procedure 변경과 stable ENGINE request ID만 포함하며
ENGINE handler, DB schema, journal/publisher foundation은 변경하지 않았다.

## 혼합 또는 validation 이관이 먼저 필요한 route

| route | 현재 procedure / outer transaction | 보류 근거 |
| --- | --- | --- |
| `inherit.buyHiddenBuff`, `inherit.setNextSpecialWar`, `inherit.resetSpecialWar`, `inherit.resetTurnTime`, `inherit.resetStat`, `inherit.buyRandomUnique` | `authedProcedure`, 있음 (`app/game-api/src/router/inherit/index.ts:343`, `:405`, `:486`, `:542`, `:599`, `:746`) | ENGINE `patchGeneral` 뒤 API transaction이 inheritance point, inheritance log, 일부 user-state를 쓴다(`:388-402`, `:464-483`, `:523-539`, `:581-596`, `:700-742`, `:777-790`). 현재 outer transaction도 먼저 commit된 ENGINE 변경을 rollback하지 못한다. 한 ENGINE command로 합치거나 durable saga가 필요하다. |
| `nation.setNotice`, `nation.setScoutMsg`, `nation.setSecretLimit`, `nation.setRate`, `nation.setBlockWar`, `nation.setBill`, `nation.setBlockScout` | `authedProcedure`, 있음 (`app/game-api/src/router/nation/endpoints/setNotice.ts:11`, `setScoutMsg.ts:11`, `setSecretLimit.ts:10`, `setRate.ts:10`, `setBlockWar.ts:10`, `setBill.ts:10`, `setBlockScout.ts:10`) | API가 actor 권한과 nation meta를 읽어 full metadata patch를 합성한다. ENGINE `setNationMeta`는 `_updatedAt` CAS만 검사하고 actor 권한을 알지 못한다(`app/game-engine/src/turn/worldCommandHandler.ts:430-472`). actor/permission을 command와 ENGINE validation으로 옮긴 뒤 전환한다. |
| `npc.setNationPolicy`, `npc.setNationPriority`, `npc.setGeneralPriority` | `accessAuthedInputProcedure`, 있음 (`app/game-api/src/router/npc/index.ts:540`, `:703`, `:756`) | API가 nation/general/world를 읽어 권한, unit-set 기반 기본값과 full policy object를 합성한 뒤 같은 `setNationMeta` CAS를 사용한다(`:540-702`, `:703-755`, `:756-807`). ENGINE이 권한/합성 의미를 소유하지 않는다. |
| `tournament.join`, `tournament.placeBet` | `authedProcedure`, 있음 (`app/game-api/src/router/tournament/index.ts:376`, `:523`) | PostgreSQL ENGINE resource/meta 명령과 Redis-owned participants/bets를 결합하고 실패 시 보상 ENGINE 명령을 보낸다(`:376-463`, `:523-628`). 하나의 DB transaction이 아니며 durable saga/Redis atomic revision이 필요하다. |
| `vote.submitVote` | `authedProcedure`, 있음 (`app/game-api/src/router/vote/index.ts:349-528`) | API transaction이 vote row를 insert한 뒤 ENGINE `voteReward`를 기다리고 commit 뒤 front-status publish를 수행한다. vote/reward 단일 소유 command 또는 idempotent saga 없이는 분리할 수 없다. 이 작업에서는 vote journal/publisher를 수정하지 않았다. |

합계 19개 route다. 특히 inheritance/vote의 현재 outer transaction은 API 절반만
rollback하므로 “원자적”이라고 간주하면 안 된다.

## 이미 API outer transaction이 없는 정상 route

| route | 근거 |
| --- | --- |
| `general.adjustIcon` | `engineAuthedProcedure`; `app/game-api/src/router/general/index.ts:584-610`. helper가 stable account-icon request ID로 ENGINE command를 보냄. |
| `general.ensureDieOnPrestartStatus`, `general.dieOnPrestart`, `general.buildNationCandidate`, `general.instantRetreat` | `accessEngineAuthedProcedure`/`accessEngineAuthedInputProcedure`; `app/game-api/src/router/general/index.ts:612-656`. user/general 조회는 outer transaction 밖이고 command마다 stable request ID가 있다. |
| `join.selectPoolGeneral`, `join.reselectPoolGeneral`, `join.createGeneral`, `join.possessGeneral` | `engineAuthedProcedure`; `app/game-api/src/router/join/index.ts:390`, `:434`, `:462`, `:585`. client request ID가 있으면 user-scoped durable ENGINE identity를 사용한다. |

합계 9개 route다.

## 검증 계약

- `app/game-api/test/inGameMenuPermissions.test.ts`: converted access-engine route가 mock
  `$transaction`을 호출하지 않고 기존 형식의 stable ENGINE request ID를 전달한다.
- `app/game-api/test/nationPersonnelRouter.test.ts`: nation personnel route의 동일 계약을
  검증한다.
- `app/game-api/test/troopRouter.test.ts`: troop mutation의 동일 계약을 검증한다.
- `app/game-api/test/auctionRouter.test.ts`: auction mutation이 API transaction 없이
  daemon command와 Redis timer projection을 완료하는 계약을 검증한다.
- raw inventory 재검색: `rg -n "requestCommand\\(" app/game-api/src/router`와
  `openAuctionWithDaemon`, `patchGeneral`, `updateNationMeta`,
  `adjustAccountIconForUser` caller 검색을 함께 실행해야 helper 경유 route를 놓치지 않는다.
