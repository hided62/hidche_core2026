# 게임 시계

시간 규칙은 `GAME_TIME`, `WALL_TIME`, `MONOTONIC_ELAPSED_TIME`로
나뉩니다. 게임 진행의 권위는 `world_state.clock_tick`, 영속 wall
판정의 권위는 PostgreSQL UTC 시계, 프로세스 내부 경과시간의 권위는
monotonic clock입니다. 장수 턴·외교 효력·게임 경매·투표·대회는 GAME,
일반 메시지·계정·감사·lease·retry는 WALL입니다. 전체 필드별 계약은
[`time-domains.md`](./time-domains.md)를 따릅니다.

한 턴은 항상 `36,000,000` tick입니다. `tick_seconds`가 바뀌면 현재 GAME 표시
시각이 유지되도록 `clock_base_time`을 다시 계산하므로, 기존 장수 턴 순서와
남은 턴 수가 보존됩니다. GAME 규칙의 DateTime은 화면/레거시 투영일 뿐이며
tick이 반드시 authority입니다. WALL 규칙은 tick이 없어도 정상이며
DateTime을 tick으로 변환해 판정하지 않습니다.

운영 중 턴 간격 변경은 Gateway의 내구성 런타임 작업으로만 수행합니다. 같은
transaction에서 `world_state`, 장수·경매·actionable message·설문 투영값과 checkpoint를
갱신하며 기존 역사/행동 로그의 `created_at`은 다시 쓰지 않습니다. 토너먼트의
Redis 투영은 DB commit 뒤 action ID로 멱등 적용됩니다.

## 실행 모드

`PREOPEN`은 사용자 명령을 처리하는 가오픈 상태입니다. 장수 생성·선택·빙의,
사전 거병·삭제·예약과 설정은 durable ENGINE 명령으로 처리하지만, 자동 턴과
명시적 `run` 요청의 시간 진행은 `RUNNING`/`MANUAL`에서만 실행합니다.
`SUSPENDED`/`RECONCILING`/`COMPLETED`를 가오픈과 같은 상태로 취급하지 않습니다.

가오픈 삭제 대기는 생성 접수의 DB WALL_TIME에 설정한 턴 간격 배수를 더한
`prestart_delete_after`로 판정합니다. 음수 GAME tick이나 화면의 게임 날짜를
그 현실 기한과 비교하지 않습니다. 사전 거병·삭제의 개시 판정은 PREOPEN phase와
`last_turn_tick`을 사용하며, Ref의 개시 cursor 동등 경계는 유지합니다.
`opentime` 표시 문자열은 일정 재투영 뒤에도 이 판정의 권위가 아닙니다.

일반·선택 장수 생성의 GAME 효과와 RNG에는 daemon의 `processing_game_tick`을
사용하고, 최초 실행 턴은 PREOPEN에서 tick 0보다 앞에 놓지 않습니다. 계정에서
가져오는 제재의 Unix `expire`는 접수 DB WALL_TIME과 비교합니다.

- `GAME_CLOCK_MODE=realtime`: `clock_wall_anchor` 이후의 실제 경과시간을
  game tick으로 환산합니다. 벽시계가 뒤로 보정되어도 game tick은 감소하지
  않습니다.
- `GAME_CLOCK_MODE=manual`: 벽시계를 읽어 게임을 전진하지 않습니다. turn
  daemon은 다음 월 tick을 즉시 관찰 시각으로 삼고 그보다 이른 장수 snapshot을
  실행하므로 wall-clock mode와 명령/RNG 순서를 유지한 채 장기 시뮬레이션을
  최대 속도로 진행할 수 있습니다. 재시작 때 남은 overdue 장수는 현재 game
  time보다 이른 범위만 먼저 처리합니다.

프로필 설치 시 선택한 모드는 DB에 저장됩니다. daemon의 환경변수는 로드한
모드를 명시적으로 덮어쓸 때만 사용해 주세요.

`SUSPENDED`와 `RECONCILING`에서는 `GameClock.nowTick()`이 wall anchor 이후의
현실 경과시간을 더하지 않고 저장된 `clock_tick`을 그대로 반환합니다. 따라서
24시간 동안 정지해도 actionable message, 토너먼트와 국가 베팅의 GAME deadline은
줄지 않습니다. 일반 메시지 envelope와 5분 삭제 기한은 별도의 DB WALL_TIME이라
같은 기간 계속 흐릅니다. 정지 전에 도착한 등용장도 envelope로 계속 수신·열람할
수 있지만, 등용 수락 효과는 daemon GAME fence가 다시 열릴 때까지 적용되지 않습니다.

이미 열린 토너먼트·국가 베팅에는 `SUSPENDED` 중에도 새 베팅을 제출할 수 있습니다.
이때 베팅 가능 여부는 frozen GAME coordinate로 판정하고, 재화 mutation은 현재
phase/revision/generation을 다시 잠가 검증합니다. 단계 전환·마감·정산은 실행하지
않으며, 원자적 reconciliation이 진행되는 `RECONCILING`에서는 새 베팅도 받지 않습니다.

daemon lease는 게임 schedule이 아니라 운영 `WALL_TIME`입니다. 게임 DB session이
`Asia/Seoul`이어도 acquire/renew/assert/release는 모두
`CURRENT_TIMESTAMP AT TIME ZONE 'UTC'`를 사용합니다. 따라서 정지한 게임의
lease도 현실 시간에 만료되며, KST session에서 UTC `timestamp without time zone`
column을 9시간 미래로 쓰지 않습니다.

## 중단 후 재개

realtime daemon은 재개할 때 Ref `checkDelay()`와 같은 한도를 적용합니다.
밀린 완전 턴 수가 턴 간격 20분 이상이면 1턴, 10분 이상이면 3턴, 그보다
짧으면 6턴을 초과할 때 장기 중단으로 봅니다. 한도 이내의 짧은 중단은 턴을
순서대로 실행해 따라잡고, 한도를 넘으면 밀린 완전 턴만큼 `last_turn_tick`,
전 장수의 `turn_tick`, 미완료 경매의 `close_tick`과 각각의 DateTime 투영값을
한 transaction에서 옮깁니다. 이 보정은 명령이나 월 이벤트를 실행하지 않으므로
건너뛴 기간의 RNG를 소비하지 않습니다. 이미 처리 중 anchor 갱신으로 표시
시각이 늦어진 상태도 현재 wall time에 맞추되 game tick은 되감지 않습니다.

운영자가 명시적으로 일정을 지연하거나 가속하려면 Gateway 작업을 사용합니다.
이 작업은 `clock_base_time`과 DateTime 투영값을 같이 이동하고, game tick 및
장수 턴 tick은 바꾸지 않습니다. 동시에 `clock_wall_anchor`를 작업 실행
시각으로 다시 고정합니다.

PREOPEN에서 이 투영 조정을 수행할 때는 예정된 `clock_wall_anchor`를 유지합니다.
GAME 표시 좌표를 옮기는 명령이 별도로 예약된 정식 WALL 오픈을 앞당기지 않습니다.

통일 후 이민족 선택을 기다리는 `UNIFICATION_WAIT`는 일반 maintenance 재개와
다릅니다. 운영상 STOP된 profile을 RESUME하면 Gateway는 프로세스만 다시 띄우고
게임 clock은 `SUSPENDED`로 유지합니다. daemon이 수신자 소유권과 command fence를
확인한 `raiseInvader` 응답만 suspension을 원자적으로 reconciliation할 수 있습니다.
한 난이도를 수락하면 같은 통일 tick의 다른 선택지는 모두 resolved 처리됩니다.
이민족전이 끝나 `isUnited=3`이 되면 clock phase도 같은 월 transaction에서
`COMPLETED`가 되어 이후 GAME_TIME이 진행하지 않습니다.

DB migration은 GAME 규칙의 기존 DateTime 투영에서 tick을 채웁니다. 새 설치와 migration
재실행은 `prisma:migrate:deploy:game`으로 수행합니다. 메시지의 연도 9999 같은
무기한 호환값은 일반 메시지의 투영일 뿐입니다. actionable deadline은
`expires_game_tick`, 일반 삭제 deadline은 `delete_until_wall`만이 authority이며
NULL에 따라 다른 시계로 fallback하지 않습니다.

## 비동기 작업의 시계 경계

외부 요청은 `InputEvent.createdAt` DB WALL_TIME으로 접수합니다. API payload가
game tick을 미리 고정하지 않으며, daemon이 clock lock/fence 아래서 claim할 때
`accepted_game_tick`/세대와 `processing_game_tick`/세대를 확정합니다. NPC,
선택, 투표, 경매, 유산 효과는 처리 tick으로 검증하며 stale revision은
적용하지 않습니다. worker history retention·lease·retry는 DB WALL_TIME,
프로세스 대기 budget은 monotonic time입니다.

daemon 종료가 이미 local queue에 있으면 새 DB 명령을 선점하지 않습니다.
실행하지 않을 명령을 `PROCESSING`으로 남겨 교체 daemon이 lease 만료를 기다리게
하지 않고, 기존 PENDING 명령은 즉시 다음 daemon이 claim할 수 있게 유지합니다.

경매 입찰은 `requested_at_wall`로 현실 요청을, `occurred_game_tick`으로 GAME
사건을 별도 기록합니다. bid 표시 투영은 같은 game time을 보존하고,
optimistic 경합 판정은 임의 UUID의
사전순이 아니라 읽은 `latest_event_id`를 버전 토큰으로 사용합니다. worker
재시작 시 `OPEN`은 `close_tick` deadline에, 이미 마감 판정이 끝난
`FINALIZING`은 현재 tick에 seed하여 durable finalization event 복구를 즉시
재시도합니다. Redis history의 score는 보존 기간 계산을 위해 운영 벽시계를
사용합니다.

## 통합 검증

`CLOCK_RECONCILIATION_DATABASE_URL`과 `REDIS_URL`을 사용하는 실제 reconciliation
검증은 conditional integration registry의 core group에 포함합니다. 일반 단위
테스트의 조건부 skip을 실제 PostgreSQL/Redis 검증 통과로 간주하지 않습니다.
