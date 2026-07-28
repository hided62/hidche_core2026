# 문서 기준선

## 코드 기준 커밋

이 핸드북의 최초 전면 갱신은 다음 상태를 기준으로 조사했습니다.

| 항목        | 값                                         |
| ----------- | ------------------------------------------ |
| 저장소      | `devsam/core2026.git`                      |
| 브랜치      | `main`                                     |
| 기준 커밋   | `1181f6f4e03cbed77b1c40b6b572585f6e395a2c` |
| 기준 일자   | 2026-07-28                                 |
| 레거시 위치 | 형제 저장소 `../ref/sam`의 `devel`         |

기준 커밋은 “이 버전이 완성됐다”는 선언이 아니라 문장과 소스 경로를 다시 대조할 출발점입니다. 이후
리팩터링에서 설명과 코드가 어긋나면 다음 순서로 갱신해 주세요.

1. 이 페이지의 기준 커밋과 현재 `main` 사이의 변경 파일을 확인합니다.
2. 해당 문서가 가리키는 entry point, 호출 순서, transaction과 오류 경로를 다시 추적합니다.
3. 커맨드 등록부를 바꿨다면 `pnpm docs:generate`로 생성 페이지의 차이를 확인합니다.
4. `pnpm docs:build`로 링크와 정적 HTML 생성을 검증합니다.
5. 기준 커밋과 기준 일자를 현재 조사한 commit으로 바꾸고, 검증하지 못한 범위를 명시합니다.

## 사실 수준

- 이 핸드북의 아키텍처·파일·클래스 설명은 기준 커밋의 정적 코드와 기존 검증 문서를 교차 확인한
  결과입니다.
- `input_event` transaction, daemon lease, ref 차등, 실제 Chromium 같은 동작 증명은 각 테스트와
  기존 상세 문서가 담당합니다. 이 핸드북 자체의 HTML 빌드가 제품 동작을 다시 증명하지는 않습니다.
- profile과 scenario가 명령 목록·상수·맵·병종을 바꿀 수 있으므로 플레이어 화면의 현재 가능 여부가
  정적 표보다 우선입니다.

## 상세 근거 문서

- [레거시 이관 제약](./architecture/rewrite-constraints.md)
- [턴 daemon lifecycle](./architecture/turn-daemon-lifecycle.md)
- [PostgreSQL schema](./architecture/postgres-schema.md)
- [프론트엔드 CSS 구조](./frontend-css-architecture.md)
- [레거시 화면 비교](./frontend-legacy-parity.md)
