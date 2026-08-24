# game-api 직접 mutation / change journal inventory

## 범위와 판정 규칙

`app/game-api/src/router/**`에서 `.mutation()`으로 선언하고 실제 `appRouter`에 mount한
87개 route를 2026-08-24 기준으로 전수 분류한다. 이 목록은 “mutation transport를
사용한다”와 “game DB를 변경한다”를 구분한다. 신규 route가 추가되거나 선언한 router가
mount되지 않으면
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

Migration 기본 `coverageVersion`은 계속 `0`이다. 현재 binary는 ENGINE의 보수적
`dashboard.global`, API direct writer, engine message mailbox와 모든 tournament Redis
writer reconciliation을 포함한다. rolling deployment가 끝난 뒤에만
`coverage:activate:game` one-off가 shared head를 seed하고 version 1을 CAS로 활성화한다.

## 전수 목록

| 분류 | 수 | route |
| --- | ---: | --- |
| durable journal | 19 | `betting.bet`; `diplomacy.destroyLetter`, `diplomacy.respondLetter`, `diplomacy.rollbackLetter`, `diplomacy.sendLetter`; `inherit.checkOwner`; `messages.delete`, `messages.respond`, `messages.send`; `turns.reserved.repeatGeneral`, `turns.reserved.setGeneral`, `turns.reserved.setGeneralBulk`, `turns.reserved.setNation`, `turns.reserved.setNationBulk`, `turns.reserved.shiftGeneral`; `vote.closePoll`, `vote.createPoll`, `vote.submitVote`, `vote.updatePoll` |
| separate access journal | 1 | `public.recordAccess` |
| explicit no realtime consumer | 7 | `board.writeArticle`, `board.writeComment`; `join.listPossessCandidates`; `messages.readLatest`; `turns.reserved.repeatNation`, `turns.reserved.shiftNation`; `vote.addComment` |
| engine owned | 38 | `auction.bidBuyRice`, `auction.bidSellRice`, `auction.bidUnique`, `auction.openBuyRice`, `auction.openSellRice`, `auction.openUnique`; `general.adjustIcon`, `general.buildNationCandidate`, `general.dieOnPrestart`, `general.dropItem`, `general.ensureDieOnPrestartStatus`, `general.instantRetreat`, `general.setMySetting`, `general.vacation`; `inherit.openUniqueAuction`; `join.createGeneral`, `join.getSelectionPool`, `join.possessGeneral`, `join.reselectPoolGeneral`, `join.selectPoolGeneral`; `nation.appoint`, `nation.changePermission`, `nation.kick`, `nation.setBill`, `nation.setBlockScout`, `nation.setBlockWar`, `nation.setNotice`, `nation.setRate`, `nation.setScoutMsg`, `nation.setSecretLimit`; `npc.setGeneralPriority`, `npc.setNationPolicy`, `npc.setNationPriority`; `troop.create`, `troop.exit`, `troop.join`, `troop.kick`, `troop.rename` |
| mixed saga | 9 | `inherit.buyHiddenBuff`, `inherit.buyRandomUnique`, `inherit.resetSpecialWar`, `inherit.resetStat`, `inherit.resetTurnTime`, `inherit.setNextSpecialWar`; `tournament.cancel`, `tournament.join`, `tournament.placeBet` |
| Redis projection | 6 | `tournament.patchState`, `tournament.seedParticipants`, `tournament.setBettingEntries`, `tournament.setMatches`, `tournament.setParticipants`, `tournament.setState` |
| operational | 3 | `turnDaemon.pause`, `turnDaemon.resume`, `turnDaemon.run` |
| external upload | 1 | `board.uploadImage` |
| read-only mutation transport | 2 | `battle.prepareSimulation`, `battle.simulate` |
| session only | 1 | `auth.exchangeGatewayToken` |

합계는 87개다.

## durable journal dependency 매핑

| writer | durable key | public wake-up | 근거와 경계 |
| --- | --- | --- | --- |
| `betting.bet` | `general.content:<actor>`, `betting:0` | 없음 | 본인 베팅/유산 지출과 베팅 aggregate source가 바뀐다. `betting`은 현재 별도 화면 source이고 main dashboard fan-out을 만들지 않는다. |
| `inherit.checkOwner` | 확인자·확인 대상의 `messages.mailbox:<general>` | 두 장수 mailbox viewer에게 ID 없는 `messagesInvalidated` | Ref처럼 확인 결과와 피확인 알림을 시스템 개인 메시지로 저장하며 포인트 차감·유산 로그·두 메시지·journal을 한 API input-event transaction에서 commit한다. |
| 외교 문서 4개 | 양국의 `messages.mailbox:<9000+nation>` | 양국 mailbox viewer에게 ID 없는 `messagesInvalidated` | Ref의 문서 전송·승인/거부·회수·파기 알림을 외교 메시지로 저장하고, 응답은 같은 문구의 국가 메시지도 외교 메시지 뒤에 저장한다. 문서 상태·2/4개 메시지·journal을 한 API input-event transaction에서 commit한다. |
| `messages.send` | 생성된 수신/송신 복사본의 `messages.mailbox:<mailbox>` | 해당 mailbox viewer에게 ID 없는 `messagesInvalidated` | 기존 pre-commit Redis `messageCreated`를 제거했다. outbox publish 뒤에도 browser에는 mailbox/message/sender/time/revision이 노출되지 않는다. |
| `messages.delete` | 실제로 만료한 송신/수신 mailbox | 동일 | sender copy만 지우는 수동 외교 메시지는 그 mailbox만 표시한다. |
| `messages.respond` | 영향 mailbox, `records.general`, 실제 외교 변경 국가의 `nation.content`, front-state patch 도시의 `city.content`, 필요 시 `map.world`, transitive aggregate용 `dashboard.global` | mailbox boolean 및 해당 dashboard slice | 실패 로그도 commit되면 actor 개인 기록을 표시한다. 외교 수락이 실제 diplomacy/city/nation dependency를 바꿀 때만 broad source key를 표시한다. |
| general reserved turn 4개 | `reserved.general:<general>`, `dashboard.global:0` | 본인 reserved-turn slice | queue row와 CAS revision을 쓴 같은 API transaction에서 표시한다. global key는 troop leader 첫 예약턴에 의존하는 다른 장수 context를 위한 source-only 표식이다. |
| `turns.reserved.setNation`, `setNationBulk` | `general.content:<actor>`, `dashboard.global:0` | actor의 dashboard general slice | Ref가 성공한 사용자 수뇌 입력 때 `killturn`을 world 기본 이상으로 보충하는 side effect를 queue write와 같은 API transaction에 저장한다. repeat/shift는 이 side effect가 없어 no-op이다. |
| vote 4개 | 기존 `front.general`/`front.global` | front-status boolean | vote producer 작업에서 pre-commit publish를 journal로 이미 치환했다. 댓글은 active survey 제목을 바꾸지 않아 별도 화면 no-op이다. |
| `public.recordAccess` | `access.general:<general>` | 없음 | Ref 순서상 gameplay transaction 밖의 별도 access transaction에 저장한다. |

`dashboard.global`은 context/command source vector가 general/city/nation/troop/
diplomacy aggregate에 간접 의존하는 점을 위한 DB/source-only key다. dispatcher는 이를
public dashboard event로 내보내지 않는다. browser wake-up은 정밀 entity/domain key가
담당하고, source equality 검사만 이 보수적 key를 사용한다.

## 의도적으로 fan-out하지 않는 저장값

- 게시글/댓글은 현재 게시판 화면에서 사용자 action 뒤 직접 다시 읽으며 main SSE
  listener가 없다. `board.*` domain을 임의로 추가하지 않는다.
- 외교 문서(`diplomacyLetter`) 자체는 외교 문서 화면 전용이고 현재 SSE consumer가 없다.
  다만 Ref가 함께 쓰는 외교/국가 메시지는 양국 메시지 panel의 durable mailbox journal로
  전달한다. 전쟁/불가침 상태를 실제 변경하는 `messages.respond`와도 구분한다.
- `messages.readLatest`는 본인의 읽음 cursor다. 요청한 tab이 이미 최신 cursor를 알고
  있으므로 자기 자신에게 다시 wake-up을 보내지 않는다.
- nation reserved turn, selection-pool reservation과 possession 후보는 각각 전용
  화면/request response가 최신 상태를 소유한다.
- image upload는 외부 content store write이며 game PostgreSQL read model이 아니다.
- battle simulation 준비와 서버 fallback은 호환상 mutation transport를 쓰지만
  read-only 계산이며 input event transaction을 열지 않는다.

## 남은 업무 원자성 gap과 coverage 판정

1. 국가 설정 7개와 NPC policy 3개는 API outer input-event를 제거했다. semantic ENGINE
   command가 actor 권한, 현재 state와 mutation을 검증하고 국가 저장·ENGINE input-event·
   `nation.content`/`front.nation`/`dashboard.global` journal을 한 transaction에서 commit한다.
2. inheritance/tournament command 일부는 보상 가능한 saga다. tournament payload와
   profile source revision 자체는 API store, 월 자동 개막, runtime clock shift 모두 공통
   Lua writer 한 번으로 원자화했다.
3. ENGINE 일반 메시지와 통일 경매 취소 메시지는 실제 insert callback에서 mailbox를
   모아 같은 PostgreSQL transaction의 journal/outbox에 쓴다.
4. 따라서 dashboard/map coverage v1 코드 조건은 충족했지만 migration은 rolling deploy
   안전을 위해 0을 유지한다. 전체 writer binary 배포가 확인된 뒤에만 activation command를
   실행하며, 문제 시 meta를 0으로 내려 즉시 full-compute fallback한다.
