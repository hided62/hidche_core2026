# 삼국지 모의전투 HiDCHe (sammo-ts)

삼국지 모의전투 HiDCHe(삼모/삼모전/힏체섭)의 레거시 PHP 코드베이스를 TypeScript 기반 pnpm 모노레포로 재작성하는 저장소입니다.
현재 운영 중인 소스는 `legacy/` 아래에 있으며, 새 런타임은 단계적으로 전환 중입니다.

## 목표

- 레거시 PHP 기반 런타임을 TypeScript 기반 모노레포로 전환
- 게임 로직을 순수 모듈로 분리하고 API/엔진/프론트를 서비스 단위로 구성
- 서버+시나리오 프로파일별 빌드 및 배포 흐름 정립

## 구조

- `legacy/`: 현재 운영 중인 PHP 런타임
- `packages/common`: 공유 유틸 및 타입 정의
- `packages/infra`: Prisma/Redis 커넥터 등 런타임 인프라
- `packages/logic`: 순수 게임 로직 (DI/인터페이스 기반)
- `app/gateway-frontend`: 게이트웨이 UI
- `app/gateway-api`: 게이트웨이 API
- `app/game-frontend`: 게임 UI
- `app/game-api`: 게임 API
- `app/game-engine`: 턴 엔진/데몬
- `tools/build-scripts`: 빌드 및 배포 스크립트

## 개발 도구 및 스크립트

- 패키지 매니저: pnpm 워크스페이스
- 초기 개발기간 동안 npm 패키지는 가능한 최신버전을 유지
- 공통 스크립트
    - `pnpm install`
    - `pnpm lint`
    - `pnpm test`
    - `pnpm build`
    - `pnpm typecheck`: turbo를 통해 전체 패키지 타입 체크 실행
    - `pnpm dev`
- 서버 빌드
    - `pnpm build:server --profile <server> --scenario <scenario>`
    - 예: `pnpm build:server --profile che --scenario default`

## 빌드 프로파일(예정)

- 프로파일은 서버+시나리오 조합이며, 시나리오 파일 지정은 필수(기본값은 별도 정의).
- 시나리오 파일에 따라 유닛 세트, DB 세팅 등의 사전 준비가 달라짐.
- 서버 ID: `che`, `kwe`, `pwe`, `twe`, `nya`, `pya`
- 빌드 출력: `/dist/{profileName}`

## 난수 정책 (Verifiable RNG)

게임 로직에 영향을 주는 모든 난수는 재현 가능해야 합니다.
현 구현을 사용합니다: `packages/common/src/util/LiteHashDRBG.ts`, `packages/common/src/util/RNG.ts`.

## 문서

- `docs/architecture/overview.md`
- `docs/architecture/legacy-engine.md`
- `docs/architecture/rewrite-plan.md`
- `docs/architecture/runtime.md`

## 참고

레거시 데이터(`legacy/`)는 마이그레이션용으로만 유지되며, DB 이전 이후에는 런타임 의존성을 제거합니다.
