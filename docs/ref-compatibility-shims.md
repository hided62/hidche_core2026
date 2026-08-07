# Ref 호환 shim 인벤토리

이 문서는 `core2026` 제품 코드에 남아 있는 **구조가 아니라 Ref의 PHP/MariaDB
표현을 재현하기 위한 국소 보정**의 단일 인벤토리입니다. 일반 도메인 규칙,
인증·권한, RNG 소비 순서, transaction 경계와 사용자 출력은 이 목록에 넣지
않습니다. 그런 계약은 Ref 제거와 별개로 유지해야 합니다.

코드에서는 제거 후보의 최소 범위를 다음처럼 표시합니다.

```ts
// REF-COMPAT:BEGIN ref-example-id
const adjusted = legacyAdjustment(value);
// REF-COMPAT:END ref-example-id
```

한 ID가 여러 파일에 나타날 수 있습니다. `pnpm check:ref-compat-markers`는 모든
`BEGIN`/`END` 쌍, 중첩, ID 오타와 이 문서의 누락·유령 항목을 검사합니다.
표식은 feature flag가 아니며 현재 동작을 끄지 않습니다.

## 제거 원칙

1. “Ref 대응책 제거” 작업에서도 ID를 한 번에 하나씩 다룹니다.
2. 먼저 각 항목의 중립 구현을 정의하고, 해당 ID의 모든 source region과 호출부를
   찾습니다. 주석만 지우는 것은 제거가 아닙니다.
3. 기존 exact test를 삭제하지 않고 중립 구현의 새 기대값으로 의도적으로
   변경합니다. canonical snapshot에서 RNG trace, 정수 결과, 저장 상태와 다음
   월까지 비교합니다.
4. PostgreSQL schema/type을 함께 바꾸는 항목은 migration·기존 DB 증분 적용·복구
   경로까지 별도 작업으로 검증합니다.
5. 구현과 검증이 끝난 뒤 source marker와 이 문서의 ID 항목을 함께 제거하고
   `pnpm check:ref-compat-markers`를 실행합니다.

## 현재 인벤토리

### MariaDB FLOAT 저장·읽기 경계

<!-- REF-COMPAT-ID: ref-mariadb-float-boundary -->

- 성격: MariaDB `FLOAT` binary32 저장과 mysqli/PDO의 6자리 유효숫자 half-even
  읽기를 JavaScript `number` 안에서 반복 재현하는 보정입니다.
- 현재 위치: `packages/logic/src/compat/legacyFloat.ts`,
  `packages/logic/src/actions/turn/general/legacyCityTrust.ts`, 기술 연구, 월간 보급·재해·
  반기 처리, 수입 계산과 전투 기술 증가 경계입니다.
- Ref 근거: `nation.tech`, `city.trust`가 `FLOAT`이고 PHP 계산과 SQL 내부 계산의
  read/write 순서가 서로 다릅니다. 최초 도입은 `58b9a23`, half-even 보강은
  `5d6923f`입니다.
- 현재 검증: `general_commands_new.test.ts`, `monthlyEventHandler.test.ts`,
  `monthlySemiAnnualAction.test.ts`, `warAftermath.test.ts`와 scenario 2601/2400
  월간 차등입니다.
- 중립 구현 후보: PostgreSQL에 저장된 full-precision 값을 그대로 읽고 쓰며
  `Math.fround`, 6자리 decimal 변환과 legacy helper를 제거합니다.
- 제거 위험: 기술·민심이 다음 명령/월간 이벤트 입력이므로 한 지점만 제거하면
  장기 진행이 더 쉽게 어긋납니다. 이 ID의 모든 region을 한 작업으로 검토합니다.

### PHP half-boundary 반올림 보정

<!-- REF-COMPAT-ID: ref-php-half-rounding -->

- 성격: JavaScript 계산값이 `.5`보다 수 ulp 아래에 머물러도 PHP `round()`처럼
  half-away-from-zero가 되도록 `Number.EPSILON`을 더하는 보정입니다.
- 현재 위치: `packages/logic/src/war/utils.ts`의 전투 정수 저장과
  `packages/logic/src/actions/turn/general/che_징병.ts`의 징병 비용입니다.
- Ref 근거: `4159.499999999999`, `8719.4999999999945` 같은 누적값 및 징병 비용의
  PHP 결과입니다. 도입 `58b9a23`, 전투 tolerance 보강 `cef6a90`입니다.
- 현재 검증: `warUtils.test.ts`, `general_commands_new.test.ts`입니다.
- 중립 구현 후보: 제품이 정한 하나의 명시적 rounding mode 또는 단순
  `Math.round()`로 교체합니다.
- 제거 위험: 음수 tie와 전투 누적 정수 결과가 바뀌므로 fixed-seed 전투 전체 상태를
  다시 승인해야 합니다.

### Decimal half 안정화 후 정수화

<!-- REF-COMPAT-ID: ref-decimal-half-stabilization -->

- 성격: `toPrecision(15)`로 이진 오차를 먼저 줄인 뒤 half-away-from-zero로
  반올림하는 2단계 보정입니다.
- 현재 위치: `monthlySemiAnnualAction.ts`, `monthlyNationStatsHandler.ts`입니다.
- Ref 근거: MariaDB가 decimal rate 식을 평가한 뒤 `ROUND()`하는 순서를 맞추기
  위해 scenario 2601 월간 일치 작업 `58b9a23`에서 추가했습니다.
- 현재 검증: `monthlySemiAnnualAction.test.ts`,
  `monthlyNationStatsHandler.test.ts`, 월간 seed parity입니다.
- 중립 구현 후보: 공통 정수 반올림 정책으로 교체하고 사전 `toPrecision(15)`를
  제거합니다.
- 제거 위험: 국가 power는 뒤의 RNG 분기와 NPC 의사결정에 영향을 줍니다.

### MeekroDB SQL 문자열 precision=14 재현

<!-- REF-COMPAT-ID: ref-meekrodb-sql-precision -->

- 성격: 전투 숙련도 누적값을 SQL 문자열에 넣기 전 PHP/MeekroDB의 14자리
  precision으로 다시 양자화하는 보정입니다.
- 현재 위치: `packages/logic/src/war/units/general.ts`의 `addDex()`입니다.
- Ref 근거: `58b9a23`의 scenario 2601 전투 후 정수 dex 경계입니다.
- 현재 검증: battle/war fixed-seed 및 differential 테스트입니다.
- 중립 구현 후보: full-precision 누적 뒤 명시적 integer 저장 정책만 적용합니다.
- 제거 위험: 숙련도와 병종 보정이 이후 전투 입력이므로 단일 전투뿐 아니라 연속
  전투를 비교합니다.

### MariaDB INT write 반올림 투영

<!-- REF-COMPAT-ID: ref-int-column-write-rounding -->

- 성격: 중간 계산값을 그대로 유지하지 않고 Ref의 정수 column write 시점마다
  `Math.round()`로 투영하는 보정입니다.
- 현재 위치: `monthlyCitySupplyAction.ts`, `monthlyDisasterAction.ts`,
  `che_물자조달.ts`의 국소 helper입니다.
- Ref 근거: 보급·재해·장수 경험/공헌이 각각 DB write 뒤 다음 action에서 다시
  읽히는 순서입니다. 월간/명령 이관 및 `58b9a23`에서 확인했습니다.
- 현재 검증: 월간 event 테스트와 `general_commands_new.test.ts`입니다.
- 중립 구현 후보: 도메인 상태의 정수 invariant를 한 저장 계층에 두거나
  full-precision 상태를 유지합니다.
- 제거 위험: 이 항목은 단순 표시 반올림이 아닙니다. 다음 action 입력과 저장
  상태를 함께 비교해야 합니다.

### 부상 적용 뒤 정수 능력치 절삭

<!-- REF-COMPAT-ID: ref-stat-injury-truncation -->

- 성격: 부상 비율을 능력치에 먼저 곱하고 trigger 계산 뒤 `Math.trunc()`하는 Ref
  순서를 별도 helper로 재현합니다.
- 현재 위치: `packages/logic/src/actions/turn/general/legacyGeneralStat.ts`입니다.
- Ref 근거: 징병 등 일반 명령의 effective stat 처리이며 `58b9a23`에서 분리됐습니다.
- 현재 검증: `general_commands_new.test.ts`와 general turn compatibility입니다.
- 중립 구현 후보: 정식 stat value object/공통 계산 정책에 흡수하거나 실수 능력치를
  유지합니다.
- 제거 위험: 성공량·비용·로그가 함께 달라질 수 있습니다.

### 수입 배분 전 pre-flush 실수 유지

<!-- REF-COMPAT-ID: ref-income-preflush-fraction -->

- 성격: 국가 정수 column에 저장될 최종 수입을 장수 급여 배분 전에는 일부러
  반올림하지 않는 순서 보정입니다.
- 현재 위치: `app/game-engine/src/turn/incomeHandler.ts`입니다.
- Ref 근거: Ref는 `943.5` 같은 persistence 전 수입으로 ratio를 계산한 뒤 최종
  국가 state만 정수화합니다. `58b9a23`에서 확인했습니다.
- 현재 검증: income/monthly 테스트와 scenario 2601 월간 parity입니다.
- 중립 구현 후보: 급여와 국가 수입에 동일한 명시적 rounding phase를 정의합니다.
- 제거 위험: 여러 장수의 급여 합과 다음 명령의 개인 자원이 바뀝니다.

### 전투 사망자 분할값의 개별 INT binding

<!-- REF-COMPAT-ID: ref-dead-split-int-binding -->

- 성격: 40%/60% 사망자 분할을 합산 뒤 한 번 반올림하지 않고 각 SQL binding
  직전에 `Math.trunc()`하는 보정입니다.
- 현재 위치: `packages/logic/src/war/aftermath.ts`의 `increaseDeadCounter()`입니다.
- Ref 근거: Ref의 `dead + %i` binding 순서이며 `58b9a23`에서 확인했습니다.
- 현재 검증: `warAftermath.test.ts`입니다.
- 중립 구현 후보: 정확한 분수 누적 또는 합계 보존형 정수 배분 정책입니다.
- 제거 위험: 월간 회복과 전쟁 수입에 연쇄 영향이 있습니다.

## 범위 밖 항목

- 비교 도구의 `tools/seed-parity/legacy-float.mjs`는 제품 동작을 바꾸지 않는
  oracle이므로 제거 대상 source marker를 붙이지 않습니다.
- `number_format`, 화면 소수점 자리수, 날짜 포맷은 사용자 출력 계약입니다.
- 전투 공식, RNG 소비, 순회/정렬, 로그와 persistence 순서는 구조적 호환 계약이며
  “트윅”이라는 이유로 일괄 제거하지 않습니다.
