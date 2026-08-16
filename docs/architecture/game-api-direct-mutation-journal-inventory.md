# game-api 직접 mutation / change journal inventory

## 범위와 판정 규칙

`app/game-api/src/router/**`에서 `.mutation()`으로 선언한 86개 route를 2026-08-16
기준으로 전수 분류한다. 이 목록은 “mutation transport를 사용한다”와 “game DB를
변경한다”를 구분한다. 신규 route가 추가되면
`app/game-api/test/directMutationJournalInventory.test.ts`가 실패하므로 소유권과
실시간 소비자를 먼저 정해야 한다.

분류 기준은 다음과 같다.

- `durable journal`: API가 성공한 DB mutation의 dashboard/message dependency를
  request-local `ChangeJournal`에 표시하고 같은 API transaction에서 revision/outbox를
  쓴다.
- `separate access journal`: gameplay input-event와 분리된 접속 계측 transaction이
  `access.general`을 직접 쓴다. public fan-out은 없다.
- `engine owned`: 실제 game mutation은 ENGINE `input_event` transaction이 소유한다.
  API에서 같은 표식을 중복 생성하지 않는다.
- `mixed saga`: ENGINE DB 변경과 API DB/Redis 변경이 하나의 atomic transaction이
  아니다. 현 상태를 atomic journal coverage로 오인하지 않는다.
- `explicit no realtime consumer`: 저장값은 바뀌지만 현재 SSE 자동 갱신 consumer가
  없다. 존재하지 않는 browser fan-out을 만들지 않는다.
- `Redis projection`: 토너먼트의 authoritative state가 현재 Redis이고 PostgreSQL
  journal과 원자적이지 않다.

`coverageVersion`은 이 inventory가 존재한다는 이유로 올리지 않으며 계속 `0`이다.
특히 mixed saga, Redis tournament state와 ENGINE writer inventory의 reconciliation이
끝나기 전 revision equality fast path를 활성화하지 않는다.

## 전수 목록

| 분류 | 수 | route |
| --- | ---: | --- |
| durable journal | 22 | `betting.bet`; `messages.delete`, `messages.respond`, `messages.send`; `nation.setBill`, `nation.setBlockScout`, `nation.setBlockWar`, `nation.setNotice`, `nation.setRate`, `nation.setScoutMsg`, `nation.setSecretLimit`; `npc.setGeneralPriority`, `npc.setNationPolicy`, `npc.setNationPriority`; `turns.repeatGeneral`, `turns.setGeneral`, `turns.setGeneralBulk`, `turns.shiftGeneral`; `vote.closePoll`, `vote.createPoll`, `vote.submitVote`, `vote.updatePoll` |
| separate access journal | 1 | `public.recordAccess` |
| explicit no realtime consumer | 15 | `board.writeArticle`, `board.writeComment`; `diplomacy.destroyLetter`, `diplomacy.respondLetter`, `diplomacy.rollbackLetter`, `diplomacy.sendLetter`; `inherit.checkOwner`; `join.getSelectionPool`, `join.listPossessCandidates`; `messages.readLatest`; `turns.repeatNation`, `turns.setNation`, `turns.setNationBulk`, `turns.shiftNation`; `vote.addComment` |
| engine owned | 27 | `auction.bidBuyRice`, `auction.bidSellRice`, `auction.bidUnique`, `auction.openBuyRice`, `auction.openSellRice`, `auction.openUnique`; `general.adjustIcon`, `general.buildNationCandidate`, `general.dieOnPrestart`, `general.dropItem`, `general.ensureDieOnPrestartStatus`, `general.instantRetreat`, `general.setMySetting`, `general.vacation`; `inherit.openUniqueAuction`; `join.createGeneral`, `join.possessGeneral`, `join.reselectPoolGeneral`, `join.selectPoolGeneral`; `nation.appoint`, `nation.changePermission`, `nation.kick`; `troop.create`, `troop.exit`, `troop.join`, `troop.kick`, `troop.rename` |
| mixed saga | 9 | `inherit.buyHiddenBuff`, `inherit.buyRandomUnique`, `inherit.resetSpecialWar`, `inherit.resetStat`, `inherit.resetTurnTime`, `inherit.setNextSpecialWar`; `tournament.cancel`, `tournament.join`, `tournament.placeBet` |
| Redis projection | 6 | `tournament.patchState`, `tournament.seedParticipants`, `tournament.setBettingEntries`, `tournament.setMatches`, `tournament.setParticipants`, `tournament.setState` |
| operational | 3 | `turnDaemon.pause`, `turnDaemon.resume`, `turnDaemon.run` |
| external upload | 1 | `board.uploadImage` |
| read-only mutation transport | 1 | `battle.simulate` |
| session only | 1 | `auth.exchangeGatewayToken` |

합계는 86개다.

## durable journal dependency 매핑

| writer | durable key | public wake-up | 근거와 경계 |
| --- | --- | --- | --- |
| `betting.bet` | `general.content:<actor>`, `betting:0` | 없음 | 본인 베팅/유산 지출과 베팅 aggregate source가 바뀐다. `betting`은 현재 별도 화면 source이고 main dashboard fan-out을 만들지 않는다. |
| `messages.send` | 생성된 수신/송신 복사본의 `messages.mailbox:<mailbox>` | 해당 mailbox viewer에게 ID 없는 `messagesInvalidated` | 기존 pre-commit Redis `messageCreated`를 제거했다. outbox publish 뒤에도 browser에는 mailbox/message/sender/time/revision이 노출되지 않는다. |
| `messages.delete` | 실제로 만료한 송신/수신 mailbox | 동일 | sender copy만 지우는 수동 외교 메시지는 그 mailbox만 표시한다. |
| `messages.respond` | 영향 mailbox, `records.general`, 실제 외교 변경 국가의 `nation.content`, front-state patch 도시의 `city.content`, 필요 시 `map.world`, transitive aggregate용 `dashboard.global` | mailbox boolean 및 해당 dashboard slice | 실패 로그도 commit되면 actor 개인 기록을 표시한다. 외교 수락이 실제 diplomacy/city/nation dependency를 바꿀 때만 broad source key를 표시한다. |
| nation metadata 7개 및 NPC policy 3개 | `nation.content:<nation>`, `dashboard.global:0`; notice만 추가로 `front.nation:<nation>` | 해당 국가 context/command/board, notice front status | `updateNationMeta()` 성공 뒤 공통 표식을 사용한다. 다만 현재 mutation 자체는 ENGINE `setNationMeta`이고 API journal transaction과 단일 DB transaction이 아닌 기존 saga다. coverage 활성화 전에 ENGINE command 소유로 합쳐야 한다. |
| general reserved turn 4개 | `reserved.general:<general>` | 본인 reserved-turn slice | queue row와 CAS revision을 쓴 같은 API transaction에서 표시한다. nation reserved turns는 main SSE consumer가 없어 명시적 no-op이다. |
| vote 4개 | 기존 `front.general`/`front.global` | front-status boolean | vote producer 작업에서 pre-commit publish를 journal로 이미 치환했다. 댓글은 active survey 제목을 바꾸지 않아 별도 화면 no-op이다. |
| `public.recordAccess` | `access.general:<general>` | 없음 | Ref 순서상 gameplay transaction 밖의 별도 access transaction에 저장한다. |

`dashboard.global`은 context/command source vector가 general/city/nation/troop/
diplomacy aggregate에 간접 의존하는 점을 위한 DB/source-only key다. dispatcher는 이를
public dashboard event로 내보내지 않는다. browser wake-up은 정밀 entity/domain key가
담당하고, source equality 검사만 이 보수적 key를 사용한다.

## 의도적으로 fan-out하지 않는 저장값

- 게시글/댓글은 현재 게시판 화면에서 사용자 action 뒤 직접 다시 읽으며 main SSE
  listener가 없다. `board.*` domain을 임의로 추가하지 않는다.
- 외교 문서(`diplomacyLetter`)는 외교 문서 화면 전용이고 현재 SSE consumer가 없다.
  전쟁/불가침 상태를 실제 변경하는 `messages.respond`와 구분한다.
- `messages.readLatest`는 본인의 읽음 cursor다. 요청한 tab이 이미 최신 cursor를 알고
  있으므로 자기 자신에게 다시 wake-up을 보내지 않는다.
- nation reserved turn, selection-pool reservation, possession 후보, inheritance owner
  확인은 각각 전용 화면/request response가 최신 상태를 소유한다.
- image upload는 외부 content store write이며 game PostgreSQL read model이 아니다.
- battle simulation은 호환상 mutation transport를 쓰지만 read-only 계산이다.

## 남은 원자성/coverage gap

1. nation metadata/NPC policy는 ENGINE DB commit 뒤 API input-event transaction이
   journal을 쓴다. API rollback과 ENGINE commit이 분리되는 기존 gap이 남는다.
2. inheritance와 tournament는 보상 가능한 saga지만 단일 transaction이 아니다.
3. Redis tournament state에는 PostgreSQL revision과 원자적인 Lua/MULTI revision이
   아직 없다.
4. ENGINE에서 생성하는 message row도 `messages.mailbox`에 연결해야 전체 mailbox
   producer coverage가 된다.
5. 위 gap과 초기 reconciliation이 끝나기 전 `read_model_revision_meta.coverage_version`
   은 반드시 `0`으로 유지한다.
