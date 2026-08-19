---
layout: home

hero:
    name: core2026 핸드북
    text: 코드와 게임 동작을 연결합니다
    tagline: 런타임, 저장 경계, 호환 검증과 플레이 방법을 현재 소스 구조에 맞춰 설명합니다.
    actions:
        - theme: brand
          text: 개발자 핸드북
          link: /developer/
        - theme: alt
          text: 플레이어 가이드
          link: /user/
        - theme: alt
          text: 릴리스 운영
          link: /release-operations
        - theme: alt
          text: 관리자 콘솔
          link: /admin-console

features:
    - title: 시스템 구조
      details: gateway, game API, turn daemon, package와 PostgreSQL·Redis의 책임을 설명합니다.
    - title: 요청과 상태
      details: session actor부터 input_event, in-memory world와 transaction flush까지 추적합니다.
    - title: ref 호환
      details: 명령·RNG·상태·로그와 Chromium 화면을 같은 fixture에서 비교합니다.
---

## 문서 안내

개발자는 [개발자 핸드북](./developer/index.md)과
[아키텍처 개요](./architecture/overview.md)에서 시작해 주세요. 플레이어는
[시간과 턴](./user/time-and-turns.md)과
[커맨드 목록](./user/command-catalog.generated.md)을 확인해 주세요. Profile과
Gateway 배포는 [릴리스 운영 매뉴얼](./release-operations.md)을 따라 주세요.
[Gateway와 게임 공통 메뉴 설정](./runtime-navigation.md)은 코드 재빌드 없이
상단 링크와 dropdown을 바꾸는 JSON 형식과 복구 경계를 설명합니다.
관리자 화면의 메뉴와 권한·운영 경계는
[관리자 콘솔](./admin-console.md)에서 확인할 수 있습니다.
게임 진행 시각과 운영 벽시계의 경계는
[게임 시계](./architecture/game-clock.md)에 설명합니다.
[패키지와 파일 경계](./architecture/package-boundaries.md)는 source import와
폴더별 책임, 자동 검사 방법을 설명합니다.
Ref 전용 수치·저장 표현 보정과 제거 절차는
[Ref 호환 shim 인벤토리](./ref-compatibility-shims.md)에 모아 둡니다.

세부 문서는 다음 책임으로 나뉩니다.

- `architecture/`: 현재 runtime, action module, scenario와 차등 검증 계약
- `developer/`: 파일 위치, 도메인 조립, 요청·저장 흐름
- `user/`: 화면, 시간, 국가 기능과 생성된 command catalog
- 루트 문서: 통합 테스트, Chromium 비교, Caddy, DB 이관과 운영 절차

작업 이력은 상위 작업공간의 `report/`에 보존합니다. ref PHP와 core2026의
구체적 대응은 상위 `../docs/ref-core2026-mapping.md`를 사용합니다.
