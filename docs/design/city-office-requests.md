# 도시 관직 자원

## 정책

인사부에서 현재 체류 중인 아국 도시의 태수·군사·종사에 자원한다. 기존 수동
임명은 유지하며, 이 요청 절차는 Core 전용 기능이다.

| 상태                                         | 기한까지 미처리한 요청    |
| -------------------------------------------- | ------------------------- |
| 공석                                         | 승인                      |
| 소유자가 없는 N장(npcState=2)·M장(3) 재직    | 승인                      |
| 다른 도시에 체류하는 유저장·빙의장 재직      | 거부                      |
| 신청자의 소속연수가 국가 기밀 공개 기준 미달 | 위 조건보다 우선하여 거부 |
| 유저장·빙의장이 해당 도시에 체류             | 신청 불가                 |

수뇌는 기본값과 관계없이 승인·거부할 수 있다. 명시적 승인은 즉시 임명한다.
승인 시 기존 지방 관직의 P1 기밀 권한을 받는다. 기본 거부 요청은 소속연수가
늘어도 자동 승인으로 전환하지 않는다. 대기 중 국가의 기밀 공개 기준이 강화되면
자동 승인 요청도 자동 거부로 제한한다.

능력치 기준은 기존 임명과 같다(태수 무력, 군사 지력은 scenario chiefMin 이상,
종사는 별도 능력치 하한 없음). 일반·도시 관직의 유저장과 빙의장만 자원할 수 있고,
noChief 벌점 및 도시 임명 lock을 검사한다. 군주·수뇌는 기존 수동 임명을 이용한다.
계급·사관 비교로 다른 유저장을 자동 교체하지 않는다.

## 기한과 충돌

- 장수당 분기 1회 접수한다. 철회·거부도 횟수를 소비한다. 대기 요청은 장수당 1건,
  도시·관직당 1건이다.
- 요청 생성의 논리 tick에서 최소 한 달(`GAME_TICKS_PER_TURN`) 뒤 첫 월 경계를
  마감으로 저장한다. 월말 직전 요청도 검토 기간이 단축되지 않는다. 정지 중에는
  논리 tick이 진행하지 않으며, 턴 시간 변경은 남은 tick을 유지한다. 운영 시계
  재정렬과 backlog 복구는 접수 시각을 보존하고 대기 마감만 이동한다.
  `game-clock-participants.json`에 occurrence KEEP/deadline SHIFT로 등록한다.
- 수뇌의 수동 임명은 요청 때문에 막히지 않는다. 수동 임명 후 조건이 바뀐 요청은
  취소한다. 자동 임명도 기존 `officer_set`을 설정한다.
- 분기 lock 초기화 전에는 무효 요청을 취소하고, 월 처리 후에는 기한이 된 요청을
  판정한다. 소속·소유자·체류 도시·도시 소유·재직자 ID·능력치·벌점·lock을 다시
  확인한다. 같은 슬롯의 재직자가 바뀌면 새 재직자를 덮어쓰지 않는다.
- 신청·승인·거부·철회 명령도 실행 시점 actor와 durable 입력 이벤트 소유자를 검사한다.

## 저장과 알림

`general.meta.cityOfficeRequest`에 장수당 마지막 요청 하나만 저장한다. 요청에는
신청자·소유자·국가·도시·관직·기존 재직자, 접수 분기, 생성/마감 tick, 기본 처리와
이유, 상태 및 결과 이유가 포함된다. `pending`에서 `approved`, `rejected`,
`withdrawn`, `cancelled` 중 하나로 종료한다. 기존 JSON metadata의 additive 확장으로
새 테이블이나 migration은 없다. 기존 입력 이벤트 idempotency와 ENGINE
transaction, dirty state flush 및 worldLoader 재시작 경로를 사용한다.

API는 일반 장수에게 본인 요청만, 수뇌에게 같은 국가의 대기 요청도 제공한다.
userId와 원본 metadata는 응답에 포함하지 않는다. 처리 결과는 개인·국가 로그에
기록한다.

메인 `getFrontStatus.cityOfficeRequests`에는 수뇌에게 대기 요청 ID만 제공한다.
요청 metadata 및 수뇌 권한 변경은 front-status projection을 무효화하여 기존
SSE read-model 갱신을 따른다. 알림 cursor는 시즌·장수·국가별로 분리한다. 새 요청은
60초간 닫을 수 있는 알림과 인사부 링크로 표시하며, 닫은 같은 요청은 재알림하지
않는다. 대기 건수 링크는 알림을 닫아도 남는다. 외부 Web Push는 이 기능의 범위가
아니다.

인사부는 기본값·이유·마감과 버튼을 짧은 항목으로 표시한다. 긴 설명문을 상시
출력하지 않는다. 기밀 조건에 해당하는 명시적 승인 확인창에는 기밀 열람 가능을
표시한다. 목록은 활성 화면에서 15초 간격 및 focus 복귀 때 갱신한다.

## 구현과 검증 진입점

- `packages/common/src/personnel/officeRequest.ts`: 영속 요청 타입·검증
- `packages/logic/src/personnel/officeRequest.ts`: 공유 자원 조건
- `app/game-engine/src/turn/cityOfficeRequests.ts`: 명령·월 처리·결과 로그
- `app/game-api/src/router/nation/endpoints/cityOfficeRequests.ts`: 인증 API·read model
- `CityOfficeRequests.vue`, `CityOfficeRequestNotice.vue`: 인사부·메인 알림
- `cityOfficeRequests.test.ts`, `cityOfficeRequestPersistence.integration.test.ts`:
  정책·기한·충돌·rollback·재시작
- `nationPersonnelRouter.test.ts`, `mainFrontStatusRouter.test.ts`: DTO 권한과 HTTP 경계
- `nationOffices.spec.ts`, `mainNavigation.spec.ts`: production Chromium 조작·알림·geometry
