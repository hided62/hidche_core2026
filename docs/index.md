---
layout: home

hero:
    name: core2026 핸드북
    text: 구현과 플레이를 한곳에서 설명합니다
    tagline: 현재 코드의 아키텍처·실행 흐름·핵심 클래스와 커맨드·시기별 이용 방법을 연결한 문서입니다.
    actions:
        - theme: brand
          text: 개발자 핸드북
          link: /developer/
        - theme: alt
          text: 플레이어 가이드
          link: /user/

features:
    - title: 코드에서 실행까지
      details: frontend, tRPC, input_event, daemon, in-memory world와 PostgreSQL flush의 실제 경계를 따라갑니다.
    - title: 커맨드와 시기
      details: 장수·국가 커맨드 전체 목록을 소스에서 생성하고, 언제 왜 실행 가능하거나 막히는지 설명합니다.
    - title: 고정된 기준선
      details: 문서가 조사한 Git 기준 커밋과 재검증 지점을 밝혀 이후 리팩터링의 출발점을 남깁니다.
---

## 문서 성격

이 사이트는 `report/`의 작업 일지가 아니라 제품 저장소 안에서 계속 갱신하는 핸드북입니다.
개발자는 [시스템 아키텍처](./developer/system-architecture.md)부터, 플레이어는
[시간과 턴](./user/time-and-turns.md)부터 읽으면 됩니다.

문서의 사실관계는 [기준 커밋](./reference-baseline.md)의 코드에서 확인했습니다. 기능을 변경했다면 같은
작업에서 관련 페이지와 자동 생성 커맨드 목록을 함께 갱신해 주세요.
