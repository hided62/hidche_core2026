# 개발자 핸드북

이 핸드북은 새 기능을 어디에 넣을지뿐 아니라 요청이 어떤 경계를 지나 상태로 남는지 설명합니다. 먼저
[문서 기준선](../reference-baseline.md)을 확인하고, 변경 성격에 따라 다음 순서로 읽어 주세요.

| 변경하려는 것              | 먼저 읽을 문서                                       | 주로 확인할 코드                             |
| -------------------------- | ---------------------------------------------------- | -------------------------------------------- |
| 화면·라우팅·조회 API       | [시스템 아키텍처](./system-architecture.md)          | `app/*-frontend`, `app/*-api`                |
| 턴 입력·게임 상태 mutation | [요청·턴·저장 흐름](./request-turn-persistence.md)   | `app/game-api`, `app/game-engine`            |
| 명령·전투·월간 로직        | [도메인 로직과 핵심 클래스](./domain-and-classes.md) | `packages/logic`, `app/game-engine/src/turn` |
| 새 파일 위치·검증 범위     | [파일 지도와 변경 절차](./code-map.md)               | package manifest, test, docs                 |

## 읽을 때 지켜야 할 경계

- `packages/logic`의 순수 계산과 `app/game-engine`의 scheduling·persistence orchestration을 구분합니다.
- game API가 mutation을 받는 것과 engine이 world mutation을 확정하는 것은 다른 단계입니다.
- PostgreSQL `input_event`가 내구성 있는 작업 경계이며 Redis는 realtime fan-out과 일부 보조 worker
  통신에 사용됩니다.
- 로그인한 사용자, 게임 장수, 국가 직책은 같은 개념이 아닙니다. actor와 소유권은 session에서
  서버가 결정합니다.
- `resources/`의 scenario·map·unit set·turn-command profile이 런타임 구성을 바꿉니다. 기본 TypeScript
  목록만 보고 실제 profile을 단정하지 않습니다.
- ref 호환 변경은 결과뿐 아니라 판정·정렬·반올림·RNG 소비·로그·저장 순서를 비교합니다.

## 기존 상세 문서와의 관계

이 핸드북은 탐색용 상위 지도입니다. 상세한 호환 근거와 테스트 절차는 `docs/architecture/*`,
`docs/integration-tests.md`, `docs/frontend-legacy-parity.md`에 유지합니다. 상위 작업공간의
`../docs/ref-core2026-mapping.md`는 ref entry point와 core 구현의 end-to-end 대응 인덱스입니다.
