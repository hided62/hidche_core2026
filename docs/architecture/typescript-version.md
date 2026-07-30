# TypeScript 버전 정책

## 버전

Workspace 전체는 TypeScript `6.0.2`를 정확한 버전으로 사용합니다.
`pnpm-workspace.yaml`의 override가 transitive resolution에도 같은 버전을
적용합니다.

적용 범위는 다음과 같습니다.

- 루트 개발 도구
- `app/*`
- `packages/*`
- `tools/*`

Package별 다른 TypeScript 버전, caret range, alias와 fallback compiler를
추가하지 않습니다. `pnpm-lock.yaml`에는 승인된 한 버전만 resolve되어야
합니다. Ref PHP 저장소 `../ref/sam`의 도구 체인은 이 workspace 정책에
포함되지 않습니다.

공유 `tsconfig.base.json`은 TypeScript 6의 `baseUrl` deprecation 경고에
대해 `ignoreDeprecations: "6.0"`을 사용합니다. Package별 suppression을
추가하지 않습니다.

## 버전 변경

Compiler major version은 workspace 전체를 한 변경으로 갱신합니다. 다음
항목을 모두 확인해 주세요.

1. 저장소 script가 사용하는 compiler API
2. `typescript-eslint`, `vue-tsc`, tsdown, Vite와 Prisma 도구 지원
3. 모든 manifest와 lockfile의 단일 version resolution
4. `CI=1 pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`
5. `pnpm check:legacy:general`, `pnpm check:legacy:nation`
6. 별도 compiler 설치나 alias 없이 실행되는 비교 도구

검증되지 않은 compiler major version을 package 한 곳에만 적용하지 않습니다.
