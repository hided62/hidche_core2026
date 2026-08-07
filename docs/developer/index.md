# 개발자 핸드북

## 읽기 순서

| 작업                  | 문서                                                            | 코드 시작점                    |
| --------------------- | --------------------------------------------------------------- | ------------------------------ |
| 전체 구조             | [아키텍처 개요](../architecture/overview.md)                    | `app/`, `packages/`, `tools/`  |
| process·worker·daemon | [런타임 아키텍처](../architecture/runtime.md)                   | app server와 CLI               |
| profile·Gateway 배포  | [릴리스 운영 매뉴얼](../release-operations.md)                  | Admin GUI와 release-controller |
| 파일 위치             | [파일 지도](./code-map.md)                                      | router, handler, schema        |
| package 의존 방향     | [패키지와 파일 경계](../architecture/package-boundaries.md)     | `packages/*`, `app/*`          |
| 명령·전투·효과        | [도메인과 조립](./domain-and-classes.md)                        | `packages/logic`               |
| mutation·flush        | [요청·턴·저장](./request-turn-persistence.md)                   | game API, game engine          |
| action module         | [행동 모듈 프로토콜](../architecture/action-module-protocol.md) | `actionModules/`               |
| ref 비교              | [차등 검증](../architecture/turn-state-differential-testing.md) | `tools/integration-tests`      |

## 경계

- `packages/logic`은 계산과 규칙을 소유합니다.
- runtime I/O는 logic의 port를 app/infra adapter가 구현해 주입합니다.
- `app/game-engine`은 clock, queue, AI, 월간 순서, transaction과 flush를
  소유합니다.
- `app/game-api`는 transport, 인증, input validation과 request acceptance를
  소유합니다.
- `packages/infra`의 Prisma schema와 migration은 영속 구조의 기준입니다.
- `resources`는 scenario, map, unit set과 command profile을 구성합니다.
- actor와 resource owner는 session과 DB에서 서버가 결정합니다.
- `InputEvent`와 PostgreSQL transaction이 gameplay mutation의 내구성
  경계입니다.
- Redis와 SSE는 session·worker·fan-out 경로이며 world commit의 대체 저장소가
  아닙니다.

기능을 변경하면 상위 `../docs/ref-core2026-mapping.md`의 ref entry point,
호출 순서, 인증, DB mutation, RNG와 오류 경로를 함께 갱신해 주세요.
