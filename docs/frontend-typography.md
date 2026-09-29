# 프로필 UI 글자 크기

Gateway를 제외한 모든 게임 profile의 공통 정책이다. 2026-09-29 사용자 요청에
따른 의도적 Core UX 차이이며 Ref의 작은 글자를 그대로 유지하는 계약을 대체한다.
권한, 게임 데이터, 로그 내용·색상, 이미지와 사용자 작성 HTML 저장값은 바꾸지 않는다.

## 기본 단계와 작은 설명

| 역할               | 토큰 / 공통 class                  | 최대 기본 크기 |
| ------------------ | ---------------------------------- | -------------- |
| 큰 제목            | `title` / `sammo-text-title`       | 24px           |
| 강조, 소제목       | `emphasis` / `sammo-text-emphasis` | 16px           |
| 본문, 일반 조작    | `normal` / `sammo-text-normal`     | 14px           |
| 보조 정보, 밀집 표 | `small` / `sammo-text-small`       | 12px           |

토큰 접두사는 `--sammo-font-size-`이다. 화면 selector도 같은 토큰을 쓴다.
반응형 breakpoint는 위 네 단계 중 하나를 선택한다.

공통 `typography.css`는 `small`, `sub`, `sup`, `.sammo-text-smaller`, 게임 로그의
`.legacy-small`에 바로 아래 단계를 적용한다. 24→16→14→12px 순서이며 12px 안의
작은 설명만 10px를 허용한다. 중첩해도 10px 아래로 내려가지 않는다. 일반 본문이나
조작 버튼에 다섯 번째 단계를 직접 지정하지 않는다. 개별 화면의 `small` reset은
추가하지 않는다. 로그 formatter의 semantic 옵션은 game frontend에서만 사용하므로
Gateway 등 다른 소비자의 기존 상대 크기는 유지된다.

사령부 12턴 요약은 12px, 행 높이 16px를 사용한다. 기존 11.25px 행에서 글자만
키우면 겹치므로 두 줄 header는 32px, 카드 224px, 전체 요약 448px로 함께 조정했다.
인사부 모바일 이름은 16px, 명장·명예의 전당 이름과 토너먼트 작은 조작은 12px다.
전투 요약의 이름·병력도 12px로 표시하며 의미와 색상은 유지한다.

## 칸에 맞춘 축소

자동 축소의 최대값도 위 네 단계 중 하나여야 한다. 짧은 글자를 임의의 크기로
확대하지 않는다. 기존 빙의 이름은 16px를 기본으로 긴 이름을 12px로 낮춘다.

명장·명예의 전당의 고정 폭 이름칸은 공통 `vFitText` directive와
`.sammo-fit-text`를 사용한다. CSS의 12px에서 실제 로드된 폰트의 text range를
측정하고 칸보다 길 때만 축소한다. 너비·텍스트·font 로딩이 바뀌면 최대 단계부터
다시 계산하므로 짧아진 이름은 원래 크기를 회복한다. 10px에서도 넘치는 극단적인
반각 이름은 말줄임하며 원문을 DOM과 `title`에 남긴다. 이 경우 10~12px 사이의
실측값은 고정 예외 크기가 아니라 네 단계에 상한을 둔 자동 축소 결과다.

## 별도 콘텐츠 경계

- 국가 소개·임관 권유문 등 사용자 작성 HTML의 명시적 크기와 개인 CSS는 사용자
  설정이다. 저장된 HTML이나 editor의 글자 크기 선택지는 변환하지 않는다.
  editor의 선택지 UI 자체는 일반 크기를 상속한다.
- 위 HTML을 미리 보여 주는 축소 preview의 transform과 사용자가 고른 화면 배율은
  글자 크기 토큰과 별개다. audit에서 computed 크기와 viewport scale을 함께 기록한다.
- 숨김·복사용 marker는 0px를 유지한다. 화면 본문 단계로 세지 않는다.
- Canvas 차트의 축·범례·tooltip도 공통 small 토큰과 화면 font family를 사용한다.

새 고정 크기 예외는 화면 목적과 geometry 근거, 후속 설계 필요성을 문서화한다.
단순히 칸이 좁다는 이유로 11px, 15px 같은 별도 토큰을 만들지 않는다.

## 검증

`typographyPolicy.spec.ts`는 production Chromium에서 실제 폰트 로딩, 단계별 중첩,
최대 이름, 사령부 행 높이, 자동 축소 상한과 말줄임, 로그 크기를 확인한다.

전체 페이지 audit는 [audit 실행 안내](frontend-typography-audit.md)를 따른다.
router의 모든 선언을 scene 목록과 대조하고, 각 scene의 screenshot·DOM·computed
style·text range·이미지 크기와 fixture 응답을 남긴다. 500/1000px와 실제 390px
기기의 화면 모드를 별도로 실행한다. 9개 전각·18개 반각 이름을 사용한다.

API 응답을 고정한 frontend 검증이다. 운영 DB, 실제 계정의 임의 HTML, 공개 HTTPS나
배포 성공의 증거로 확대하지 않는다. 값이 바뀔 수 있는 예외는 고정 토큰으로
위장하지 않고 생성 이유와 상한을 함께 검사한다.
