# TypeScript 버전 정책

## 버전

Workspace의 Vite, Vue/Volar, typescript-eslint와 compiler API 소비자는
TypeScript `6.0.3`을 정확한 버전으로 사용합니다. `pnpm-workspace.yaml`의
override가 transitive resolution에도 같은 버전을 적용합니다.

CLI project build/typecheck는 TypeScript `7.0.2` native compiler를 사용합니다.
루트의 `@typescript/native`는 `npm:typescript@7.0.2` alias이며, `tsc7` script가
그 package의 `tsc` binary를 명시적으로 실행합니다. 각 package의 `tsc -b`나
`tsc -p`는 PATH의 우연한 binary 선택에 의존하지 않고 `pnpm -w tsc7 ...`를
통해 이 script를 호출합니다. Vue SFC 검사는 계속 `vue-tsc`와 TypeScript 6.0.3
API를 사용합니다.

TypeScript 7의 공식 side-by-side 안내에 있는 `@typescript/typescript6` package는
현재 6.0.2까지만 배포되어 있으므로, 6.0.3 API는 일반 `typescript` package로
설치합니다. 두 package가 모두 `tsc` 이름을 제공할 수 있는 PATH 충돌을 피하기
위해 project script는 반드시 명시적인 `tsc7` entry point를 사용합니다.
`pnpm check:typescript-toolchain`은 root와 두 frontend의 API resolution 및 native
CLI version을 함께 검사합니다.

적용 범위는 다음과 같습니다.

- 루트와 frontend의 Vite/Vue/compiler API: TypeScript 6.0.3
- `app/*`, `packages/*`, `tools/*`의 project build/typecheck: TypeScript 7.0.2

Package별 다른 TypeScript 버전이나 caret range를 추가하지 않습니다. 승인된
두 compiler의 역할은 `typescript` 6.0.3 API와 `@typescript/native` 7.0.2 CLI로
고정합니다. Ref PHP 저장소 `../ref/sam`의 도구 체인은 이 workspace 정책에
포함되지 않습니다.

공유 tsconfig와 package tsconfig는 TypeScript 7에서 제거된 `baseUrl`을
사용하지 않습니다. `paths` target은 각 설정 파일 기준의 명시적 상대경로로
작성하여 TypeScript 6, TypeScript 7과 Vite의 경로 해석을 일치시킵니다.

## 버전 변경

Compiler major version은 workspace 전체를 한 변경으로 갱신합니다. 다음
항목을 모두 확인해 주세요.

1. 저장소 script가 사용하는 TypeScript 7 CLI와 TypeScript 6 compiler API
2. `typescript-eslint`, `vue-tsc`, tsdown, Vite와 Prisma 도구 지원
3. 모든 manifest와 lockfile에서 승인된 두 역할의 exact version resolution
4. `CI=1 pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`
5. `pnpm check:legacy:general`, `pnpm check:legacy:nation`
6. `tsc7 --version`, `vue-tsc --version`과 `import('typescript').version`의
   실제 binary/API resolution

검증되지 않은 compiler major version을 package 한 곳에만 적용하지 않습니다.
