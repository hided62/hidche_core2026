---
layout: home

hero:
    name: core2026 핸드북
    text: 처음 배우는 게임, 함께 이해하는 코드
    tagline: 게임이 처음인 플레이어부터 프로그래밍 입문자와 경험자까지, 필요한 순서로 읽는 안내서입니다.
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

게임이 처음이라면 [삼국지 모의전투 첫 안내](./user/index.md)부터 읽으세요.
프로그래밍 기초만 안다면 [기초 구조 안내](./developer/first-steps.md), 개발 경험이
있다면 [경험자를 위한 시스템 읽기](./developer/system-walkthrough.md)에서 시작합니다.
[용어 사전](./user/glossary.md)은 국가 메시지와 게시판의 줄임말을 풀어 줍니다.

Profile과
Gateway 배포는 [릴리스 운영 매뉴얼](./release-operations.md)을 따라 주세요.
[Gateway와 게임 공통 메뉴 설정](./runtime-navigation.md)은 코드 재빌드 없이
상단 링크와 dropdown을 바꾸는 JSON 형식과 복구 경계를 설명합니다.
관리자 화면의 메뉴와 권한·운영 경계는
[관리자 콘솔](./admin-console.md)에서 확인할 수 있습니다.
[플레이 감사 운영](./play-audit-operations.md)은 현재 제공하는 관리자 조사 기능과
수집 범위를 설명합니다. [설계](./design/play-audit.md)는 요구사항과 비용·배경의 참고 문서입니다.
게임 진행 시각과 운영 벽시계의 경계는
[게임 시계](./architecture/game-clock.md)에 설명합니다.
[패키지와 파일 경계](./architecture/package-boundaries.md)는 source import와
폴더별 책임, 자동 검사 방법을 설명합니다.
수치 상태의 정밀도와 정수화 경계는
[수치 상태 정책](./numeric-state-policy.md)에 정리합니다.

세부 문서는 다음 책임으로 나뉩니다.

- `architecture/`: 현재 runtime, action module, scenario와 차등 검증 계약
- `developer/`: 파일 위치, 도메인 조립, 요청·저장 흐름
- `user/`: 게임 입문, 장수·내정·전쟁·외교, 게시판 용어와 명령 참고서
- `design/`: 기능의 구현 목표·비용·검증 계약과 설계 배경
- 루트 문서: 통합 테스트, Chromium 비교, Caddy, DB 이관과 운영 절차

작업 이력은 상위 작업공간의 `report/`에 보존합니다. ref PHP와 core2026의
구체적 대응은 상위 `../docs/ref-core2026-mapping.md`를 사용합니다.
