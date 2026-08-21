# 시나리오 리소스 합성

`resources/scenario/scenario_*.json`은 공통 이벤트, 규칙과 아이템 구성을
`extends`로 조합할 수 있습니다. 시나리오마다 같은 배열과 아이템 표를 복사하지
말고, 독립적으로 켜고 끌 수 있는 기능은 `resources/scenario/extensions/`
아래의 작은 확장 리소스로 분리해 주세요.

## 기본 형태

다음 시나리오는 표준 월 이벤트와 구매 가능한 전투 특기·유니크 아이템 구성을
함께 사용합니다.

```json
{
    "title": "조합 시나리오",
    "extends": ["extensions/events/standard.json", "extensions/items/buyable-war-special-uniques.json"],
    "startYear": 184,
    "const": {
        "defaultMaxGeneral": 500
    }
}
```

경로는 현재 리소스 파일을 기준으로 해석합니다. 절대 경로, 시나리오 리소스
루트 밖으로 나가는 `../` 경로와 순환 참조는 거부합니다. 확장 파일도 다른
확장 파일을 `extends`할 수 있습니다.

## 합성 규칙

1. `extends` 배열을 왼쪽부터 차례로 합성합니다.
2. 마지막에 현재 파일의 값을 적용합니다.
3. 객체는 key별로 재귀 병합합니다.
4. 배열과 문자열·숫자·boolean·`null`은 뒤 레이어의 값으로 교체합니다.

따라서 `const.allItems`처럼 객체인 설정은 여러 확장에서 slot 또는 item key를
추가할 수 있습니다. 반대로 `events`와 `availableSpecialWar`처럼 순서가 계약인
배열은 암묵적으로 이어 붙이지 않습니다. 배열을 바꾸는 확장이 전체 배열과
순서를 소유하도록 작성해 주세요. 같은 key를 여러 확장이 설정한다면
`extends`의 뒤쪽 확장이 우선하며, 시나리오 본문이 항상 최종 우선권을 가집니다.

`default.json`의 능력치·아이콘 기본값은 확장 합성이 끝난 뒤
파서에서 적용됩니다. `parseScenarioDefinition()`은 합성된 객체를
정규화하는 함수이므로 파일을 직접 읽는 코드에서는 사용하지 말아 주세요.
실제 설치는 `loadScenarioDefinitionById()`, Git commit 미리보기는
`composeScenarioResource()`를 거쳐 같은 합성 규칙을 사용합니다.

## 제공하는 확장

| 경로                                                | 내용                                     |
| --------------------------------------------------- | ---------------------------------------- |
| `extensions/events/classic.json`                    | 초기 core 시나리오 공통 월 이벤트        |
| `extensions/events/standard.json`                   | 역사·가상 시나리오 표준 천통 이벤트      |
| `extensions/events/expanded.json`                   | 후기 이벤트 시나리오의 교역·천통 이벤트  |
| `extensions/initial-events/research.json`           | 도시 초기화 이벤트                       |
| `extensions/initial-events/expanded.json`           | 전 도시 교역 초기화 이벤트               |
| `extensions/items/buyable-war-special-uniques.json` | 구매 가능한 전특과 해당 유니크 아이템 풀 |

시나리오 80개 중 70개가 확장을 사용합니다. 구매 가능한 전특·유니크 표를
사용하는 10개 시나리오는 같은 item 확장을 참조합니다.

## 적용 범위와 Ref 차이

Ref에는 설치 시 선택한 시나리오에 별도 기능 팩을 덧붙이는 전역 애드온 단계가
없습니다. 각 `scenario_*.json`이 `const.allItems`와
`const.availableSpecialWar`를 직접 소유하고, `Scenario::buildConf()`가 그 값을
`GameConst`에 반영합니다.

Core의 `extends`는 이 중복 값을 소스에서 재사용하기 위한 합성 기능입니다.
설치 시 임의의 시나리오에 전역으로 적용되는 옵션이 아니며, 해당
`scenario_*.json`이 확장을 명시한 경우에만 로더와 Gateway 미리보기가 합성합니다.
따라서 일반 공백지 시나리오에는
`extensions/items/buyable-war-special-uniques.json`이 암묵적으로 적용되지 않습니다.

장비 매매의 구매 목록과 실행 검증도 같은 경계를 사용합니다. 합성된
`const.allItems`에서 수량이 `0` 이하이고 item module이 `buyable`인 항목만 구매할
수 있습니다. `allItems`가 생략되었거나 빈 객체 또는 과거 문자열 `"{}"`이면 Ref
`GameConstBase`의 기본 구매 가능 장비 24종(부위별 6종)을 복원합니다. 반대로
`allItems`가 명시된 시나리오는 그 목록에 없는 전역 item module을 UI 선택지에
노출하지 않고, 조작된 예약 명령으로도 구매하지 못합니다. 유니크 장비의 판매와
로그 표시에는 전체 item catalog가 계속 필요하므로 구매 허용 목록과 catalog 자체를
분리합니다.

공백지 중 `scenario_902`(천지비급), `scenario_910`(거울세계),
`scenario_912`(다병종), `scenario_913`(무한대흥)은 Ref 자체가 전투 특기 아이템
풀을 직접 정의합니다. 이 네 시나리오는 최신 공통 확장과 항목 또는 유니크 수량이
서로 달라 직접 정의를 유지합니다. 특히 902·912는 `견고`가 없는 19종, 910은
`척사`가 없는 19종이며, 913은 20종이지만 일부 유니크 수량이 공통 확장의 2개가
아닌 4개입니다. 이를 공통 확장으로 바꾸면 Ref 설치 결과가 달라집니다.

## 검증

확장 파일을 추가하거나 합성 순서를 바꾼 뒤 다음 검사를 실행해 주세요.

```sh
pnpm generate:resource-schemas
pnpm validate:resources
pnpm --filter @sammo-ts/game-engine test scenarioComposition.test.ts scenarioLoader.test.ts
pnpm --filter @sammo-ts/gateway-api test scenarioCatalog.test.ts
```

`validate:resources`는 하위 `extensions/**/*.json`도 재귀적으로 검사합니다.
`scenarioLoader.test.ts`는 시나리오 80개를 합성 로더로 모두 읽습니다. 합성
구조를 바꿀 때에는 기준 JSON과 결과를 전수 구조 비교하여 이벤트 배열 순서와
`const` 값이 같은지 확인해 주세요.
