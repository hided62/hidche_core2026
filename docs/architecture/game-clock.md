# 게임 시계

게임 진행 시각은 `world_state.clock_tick`이 기준입니다. 벽시계는 daemon lease,
요청 timeout, 처리 budget과 같은 운영 제어에만 사용합니다. 장수 턴, 메시지
유효기간, 투표, 경매와 대회 마감은 game tick 또는 그 tick에서 투영한 시각을
사용합니다.

한 턴은 항상 `36,000,000` tick입니다. `tick_seconds`가 바뀌면 현재 표시
시각이 유지되도록 `clock_base_time`을 다시 계산하므로, 기존 장수 턴 순서와
남은 턴 수가 보존됩니다. DateTime 필드는 이전 데이터와 화면을 위한 투영값이며
tick 필드가 존재하면 tick이 우선합니다.

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

운영 중단 시간을 따라잡지 않으려면 Gateway의 일정 지연/가속 작업을 사용해
표시 기준시각을 옮깁니다. 이 작업은 `clock_base_time`과 DateTime 투영값을
같이 이동하고, game tick 및 장수 턴 tick은 바꾸지 않습니다. 동시에
`clock_wall_anchor`를 작업 실행 시각으로 다시 고정하므로 장기간 중단 뒤에도
누락된 기간의 턴을 몰아서 실행하지 않습니다.

DB migration은 기존 DateTime 값에서 tick을 채웁니다. 새 설치와 migration
재실행은 `prisma:migrate:deploy:game`으로 수행합니다. 메시지의 연도 9999 같은
무기한 호환값은 안전한 정수 범위를 넘을 수 있으므로 tick을 `NULL`로 두고
DateTime fallback을 사용합니다.
