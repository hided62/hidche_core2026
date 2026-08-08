# 패키지와 파일 경계

## 의존 방향

제품 소스의 의존 방향은 다음과 같습니다.

```text
packages/common
       ↑
packages/logic ← packages/infra
       ↑              ↑
       └──── app/game-engine ────┐
                    ↑             │
           app/game-api    app/gateway-api
                    ↑             ↑
           game-frontend   gateway-frontend
```

화살표의 시작점이 끝점을 import합니다. `packages/logic`은 DB, Redis, 파일,
네트워크, 환경 변수와 stdout을 직접 사용하지 않습니다. 런타임 관찰이 필요한
경우 `packages/logic/src/ports/`에 포트를 선언하고 app 계층에서 구현을
주입합니다. Prisma 생성 타입과 connector는 `packages/infra`가 소유하며,
도메인 enum과 규칙은 생성 client에서 다시 export하지 않습니다.

## 위치를 정하는 기준

| 위치              | 포함하는 코드                                               | 포함하지 않는 코드                                      |
| ----------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| `packages/common` | process 사이 직렬화 타입, 인증 token, 결정적 RNG, 범용 함수 | DB client, 파일 loader, 게임 mutation                   |
| `packages/logic`  | 명령·전투·AI 계산, domain type, constraint, port interface  | Prisma/Redis, `process.env`, stdout, 파일·HTTP 접근     |
| `packages/infra`  | Prisma 생성 client, PostgreSQL/Redis connector와 repository | 도메인 규칙, API 인증·validation, process orchestration |
| `app/game-engine` | daemon 조립, resource loader, in-memory state, transaction  | 재사용 가능한 순수 계산의 유일 구현                     |
| `app/game-api`    | tRPC/SSE, 인증, request validation, worker transport        | daemon process entrypoint의 암묵 실행                   |
| `app/gateway-api` | 계정·profile 정책, operation queue, PM2 orchestration       | game-engine process entrypoint의 암묵 실행              |
| `app/*-frontend`  | 브라우저 UI, store, 공개 API client                         | Node/DB runtime과 backend value import                  |

Resource를 읽는 `scenarioLoader`, `mapLoader`, `unitSetLoader`,
`turnCommandProfile`은 game-engine runtime adapter가 소유합니다. 다른 app은
동일 loader를 복사하지 않고 `@sammo-ts/game-engine/...`의 구체적인 subpath를
사용합니다. `@sammo-ts/game-engine` 루트는 daemon process entrypoint이므로
API 제품 소스에서 library처럼 import하지 않습니다.

game-engine의 공개 subpath는 `app/game-engine/package.json`의 `exports`와
`app/game-engine/tsdown.config.ts`의 entry에 함께 선언합니다. `pnpm --filter
@sammo-ts/game-engine build`는 각 JS·type export target이 실제 생성됐는지
검사하므로, typecheck에서는 보이지만 production Node에서만 실패하는 subpath
누락을 배포 전에 차단합니다.

Frontend가 tRPC router shape를 참조할 때는 `import type`만 사용하고 backend
package를 `devDependencies`에 둡니다. 브라우저에서 실제 실행하는 공유 값만
`common` 또는 `logic`의 browser-safe export에서 가져옵니다.

## 자동 검사

```sh
pnpm check:architecture
pnpm test:architecture
```

`check:architecture`는 모든 `packages/*/src`와 `app/*/src`를 읽어 다음을
검사합니다.

- 허용되지 않은 workspace package 의존
- common/logic의 DB·Redis·파일·네트워크 import와 직접 `fetch`
- logic의 직접 환경 변수·stdout 접근
- frontend의 Node import와 backend value import
- API의 game-engine 루트 entrypoint import
- `infra`에서 도메인 로그 enum을 가져오는 코드
- source import와 `package.json` dependency 종류의 불일치

Integration/E2E fixture는 실제 DB와 Node 파일 API를 사용할 수 있으므로 제품
`src` 검사와 분리합니다. 테스트 예외는 제품 코드의 경계를 완화하는 근거가
아닙니다.
