# 게임 시계

게임 진행 시각은 `world_state.clock_tick`이 기준입니다. 벽시계는 daemon lease,
요청 timeout, 처리 budget과 같은 운영 제어에만 사용합니다. 장수 턴, 메시지
유효기간, 투표, 경매와 대회 마감은 game tick 또는 그 tick에서 투영한 시각을
사용합니다.

한 턴은 항상 `36,000,000` tick입니다. `tick_seconds`가 바뀌면 현재 표시
시각이 유지되도록 `clock_base_time`을 다시 계산하므로, 기존 장수 턴 순서와
남은 턴 수가 보존됩니다. DateTime 필드는 이전 데이터와 화면을 위한 투영값이며
tick 필드가 존재하면 tick이 우선합니다.

운영 중 턴 간격 변경은 Gateway의 내구성 런타임 작업으로만 수행합니다. 같은
transaction에서 `world_state`, 장수·경매·메시지·설문 투영값과 checkpoint를
갱신하며 기존 역사/행동 로그의 `created_at`은 다시 쓰지 않습니다. 토너먼트의
Redis 투영은 DB commit 뒤 action ID로 멱등 적용됩니다.

## 실행 모드

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

DB migration은 기존 DateTime 값에서 tick을 채웁니다. 새 설치와 migration
재실행은 `prisma:migrate:deploy:game`으로 수행합니다. 메시지의 연도 9999 같은
무기한 호환값은 안전한 정수 범위를 넘을 수 있으므로 tick을 `NULL`로 두고
DateTime fallback을 사용합니다.

## 비동기 작업의 시계 경계

게임 규칙의 수락·입찰·예약 시각은 logical game time을 사용하지만 daemon
queue의 `InputEvent.createdAt`, worker history retention과 timeout은 운영
벽시계를 사용합니다. NPC 빙의 enqueue는 현재 logical game time을 event
payload의 `acceptedGameAt`에 고정합니다. queue에 들어갈 때 유효했던 token은
처리 전 game tick이 진행해도 이 저장된 논리 수락 시각으로 다시 검증합니다.

경매 입찰은 같은 logical tick에서 여러 번 일어날 수 있습니다. bid 표시
시각은 같은 game time을 보존하고, optimistic 경합 판정은 임의 UUID의
사전순이 아니라 읽은 `latest_event_id`를 버전 토큰으로 사용합니다. worker
재시작 시 `OPEN`은 `close_tick` deadline에, 이미 마감 판정이 끝난
`FINALIZING`은 현재 tick에 seed하여 durable finalization event 복구를 즉시
재시도합니다. Redis history의 score는 보존 기간 계산을 위해 운영 벽시계를
사용합니다.
