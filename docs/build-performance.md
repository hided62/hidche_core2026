# 빌드 도구와 캐시 계약

## 타입 검사기 분리

- Vite, ESLint와 일반 compiler API는 workspace의 TypeScript `6.0.3`을 사용한다.
- server project 검사와 선언 생성은 root `pnpm tsc7`의 TypeScript `7.0.2`를 사용한다.
- 두 frontend의 Vue CLI만 `tools/vue-typecheck.mjs`가
  `typescript-native-bridge@6.0.3-bridge.18.tsgo.7.0.2`의 compiler 경로를
  `vue-tsc.run()`에 전달한다. 전역 `typescript` override를 bridge로 바꾸지 않는다.
- frontend는 `noEmit`이며 `declaration`과 `declarationMap`을 명시적으로 끈다.
  선언 파일을 내지 않는 검사에서 선언 이식성 진단을 요구하지 않으며, 일반 TS와
  Vue template의 타입 검사는 유지한다.

`pnpm check:typescript-toolchain`은 API, native CLI와 bridge의 정확한 버전을 검사한다.
bridge의 Linux native binary는 glibc 환경을 요구한다. 운영 builder의 Debian
Bookworm과 같은 환경을 사용하며 Alpine/musl은 지원 대상으로 간주하지 않는다.
platform binary가 없으면 검사를 건너뛰거나 성공으로 처리하지 않고 실패한다.

일반 `pnpm --filter <frontend> build`는 Vue 검사 후 Vite bundle을 생성한다.
Turbo의 frontend `build` override는 `^build`만 선행하므로 이 내장 검사와 별도
`typecheck`를 중복 실행하지 않는다. `pnpm typecheck`는 기존처럼 두 frontend를
검사한다. 운영 `build:release`는 cached `typecheck:release`를 선행한다.

## 서버 선언 파일

tsdown은 기존 entry, target, external dependency와 JS source map 설정으로 JS를
bundle한다. `build:done` hook은 `tools/build-scripts/emit-declarations.mjs`를 호출한다.
이 hook은 package의 `tsconfig.build.json`과 root의 `pnpm tsc7`로 선언 파일과 선언
source map을 생성한다. compiler 실패와 signal은 전체 build 실패로 전파한다.

Prisma와 tRPC의 큰 inferred type graph를 한 `.d.ts`로 다시 묶지 않는다. 각
package의 공개 `dist/index.d.ts`와 명시된 subpath는 유지하고, 그 선언이 참조하는
파일도 `dist`에 함께 둔다. 이 저장소의 package는 private이며 배포 시 선언 파일
하나만 복사해서는 안 된다.

`logic`의 기존 `./* → ./dist/src/*` export는 별도 계약이다. 이 package는 native
compiler가 `dist/src`에 JS, 선언과 양쪽 source map을 함께 생성한다.
`dist/index.d.ts`는 `./src/index.js`를 재수출하는 작은 진입점이다. 루트와 하위
경로의 class가 같은 선언을 참조하므로 private member의 타입 정체성이 갈라지지
않는다. 실제 선언과 source map은 `dist/src`에 있다.

선언 생성용 config는 test를 포함하는 project-reference 검사와 분리한다. 자체
package alias는 source로, 선행 package는 공개 dist로 해석한다. 기존 타입 검사
config의 references와 test 포함 범위는 유지한다. Turbo가 dependency build 순서를
보장하며 직접 package를 빌드하기 전에는 [테스트 준비](testing-policy.md#새-worktree-준비)를
완료해야 한다.

## 캐시와 검증

일반 build key에는 root tsconfig, tsdown config와 선언/Vue 검사 도구가 포함된다.
frontend build key에는 모든 `VITE_*` 공개 입력이 포함된다. 타입 검사 task는
`!VITE_*`로 [자동 framework 환경 추론](https://turborepo.dev/docs/crafting-your-repository/using-environment-variables)을
제외한다. prefix나 배포 SHA만 바뀌어도 같은 source를 다시 타입 검사하지 않으며,
실제 Vite bundle의 공개 입력은 계속 cache key에 포함한다. 운영 frontend의 source
입력, 고정 commit, prefix와 공유 artifact 계약은
[릴리스 운영](release-operations.md)을 따른다. source map과 타입 검사를 끄는 방식으로
속도를 측정하지 않는다.

```sh
pnpm install --frozen-lockfile
pnpm check:typescript-toolchain
pnpm --filter @sammo-ts/build-scripts test
CI=1 pnpm typecheck
CI=1 RAYON_NUM_THREADS=2 NODE_OPTIONS=--max-old-space-size=8192 pnpm build --force --concurrency=1
pnpm test
```

`--force`는 Turbo cache를 우회하지만 TypeScript의 기존 `.tsbuildinfo`까지 지우지
않는다. 콜드 비교에서는 격리된 checkout의 generated dist와 `.tsbuildinfo` 조건도
맞추고, 같은 Node/pnpm, CPU·메모리 상한과 환경을 사용한다. 반복 빌드와 source
수정 후 빌드를 구분하고 cache hit 수, compiler 실패와 peak RSS를 함께 기록한다.

운영 적용은 로컬 측정과 별도다. frozen install, 실제 builder 메모리 제한, 배포
operation, 공개 prefix의 API·asset·Chromium과 기존 profile 상태를 확인한 뒤
완료로 기록한다.
