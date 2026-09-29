# 게임 시계 재정렬 실패 복구

이 문서는 운영 경험이 있는 개발자를 위한 절차입니다. 개념부터 읽으려면
[게임 시계](../architecture/game-clock.md), 계산·저장 계약은
[시계 재정렬](../architecture/game-clock-reconciliation.md)을 참고하세요.
프로세스가 살아 있다는 이유만으로 `RUNNING`을 강제하거나 outbox 행을 지우지 않습니다.

## 먼저 관찰하기

대상 게임 schema에서 `world_state.clock_phase`, `clock_revision`,
`deadline_generation`, 최신 `clock_suspension`, 참여자 checksum과 대응하는
`clock_projection_outbox`를 읽습니다. Redis의
`sammo:{profile}:clock:active-revision`과 목표 revision을 비교합니다.
DB·Redis 접속 비밀은 출력하지 않습니다.

**outbox**는 DB에서 확정했지만 다른 저장소에 전달해야 할 일을 보관한 원장입니다.
**checksum**은 재정렬 대상이 예상한 상태인지 비교하기 위한 요약값입니다.
DB와 Redis를 하나의 트랜잭션으로 묶었다고 가정하지 말고 두 단계의 상태를 봅니다.

## 상태를 해석하기

| 상태                                     | 의미와 확인할 일                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `SUSPENDED`                              | 중단 지점은 저장됐지만 일정 정렬 DB transaction은 아직 확정되지 않음                                         |
| `RECONCILING`, outbox `PENDING`·`FAILED` | DB 일정은 옮겼지만 Redis 전환이 끝나지 않음. 게임 진행을 열지 않음                                           |
| `RECONCILING`, outbox `APPLIED`          | Redis 활성 revision과 모든 참여자 checksum을 확인하고 최종 확정                                              |
| `RUNNING`                                | DB revision·deadline generation·Redis 활성 revision이 일치해야 함. 불일치하면 worker가 작업을 꺼내서는 안 됨 |

## 같은 작업을 재시도하기

시계 작업 서비스를 통해 **같은 suspension ID와 목표 revision**으로 재시도합니다.
서비스는 checksum을 다시 확인하고, 이미 적용됐다면 그 결과를 사용하거나 남은
outbox 처리를 이어갑니다. 실패를 숨기려고 새 revision을 만들지 않습니다.

`UNIFICATION_WAIT`에서는 이민족 생성을 별도 복구로 다시 실행하지 않습니다.
입력 이벤트, 정렬된 일정, 선택적 간격 변경, 결정적인 이민족 ID, 예약 턴과 outbox가
함께 확정됩니다. 명령이 확정됐고 세계가 `RECONCILING`이라면 같은 outbox만 이어
처리합니다. transaction이 rollback됐다면 원래 질문·source revision이 남으므로
ID나 RNG 결과를 바꾸지 않고 같은 응답을 재시도할 수 있습니다.

실패 위치에 따른 처리는 다음과 같습니다.

- Redis 반영 전: Lua 작업이 원래 revision에서 적용합니다.
- Redis 반영 후·DB 최종 확정 전: Lua가 이미 활성화한 결과를 돌려주고 DB 확정을
  이어갑니다. 토너먼트 기한을 두 번 이동하지 않습니다.

`lastError`가 구형 토너먼트 기한을 지목하면 tick 기록이 갖춰졌는지 확인합니다.
활성 revision을 강제하지 말고 migration이나 비활성 상태의 근거를 확인한 뒤 같은
outbox를 재시도합니다.

## 되돌리기와 검증 범위

모든 값을 반대로 이동하는 일괄 역연산은 복구 절차가 아닙니다. 운영 변경 전
정상 백업을 준비하고, 예상하지 못한 mutation이 확인되면 대상 profile을 멈춰
원장·outbox 증거를 보존합니다. 백업 복원이 필요하면 해당 시점 이후 데이터 손실
범위를 평가하고 승인된 운영 복구 절차로 game schema를 복원합니다. Redis 투영은
복원한 DB revision에서 다시 구성합니다.

조건부 시계 통합 suite는 `SUSPENDED`, Redis 적용 전·후의 실패, `APPLIED` 복구와
최종 `RUNNING`을 검사합니다. 실행에 필요한 DB·Redis가 없어 skip된 결과는 복구
검증 성공이 아닙니다. [테스트 정책](../testing-policy.md)과 해당 suite 설정을 확인하세요.
