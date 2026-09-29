# 전체 프로필 페이지 typography audit

실제 Chromium에서 router의 모든 페이지와 주요 열린 상태를 조회한다. 기존 E2E의
합성 fixture를 재사용하며 실제 게임 API와 계정에는 접속하지 않는다.
`load-fixtures.mjs`는 TypeScript compiler로 fixture 선언만 추출한다. test 등록,
`beforeEach`, 테스트 본문은 실행하지 않는다. fixture 구조가 바뀌면 audit도 함께
수정하고, 빈 화면이나 오류 화면을 정상 페이지 근거로 삼지 않는다.

## 실행

Core root에서 Node 24와 설치된 Playwright Chromium을 사용한다. prefix에 맞게
production frontend를 build하고 preview를 먼저 띄운다. frontend 준비는
[테스트 정책](testing-policy.md)을 따른다.

```sh
VITE_APP_BASE_PATH=/che VITE_GAME_API_URL=/che/api/trpc \
VITE_GAME_PROFILE=che:default pnpm --filter @sammo-ts/game-frontend build
VITE_APP_BASE_PATH=/che VITE_GAME_API_URL=/che/api/trpc \
VITE_GAME_PROFILE=che:default pnpm --filter @sammo-ts/game-frontend preview --host 127.0.0.1 --port 15331
```

다른 terminal에서:

```sh
CAPTURE_ORIGIN=http://127.0.0.1:15331 PHASE=che-cjk \
node tools/typography-audit/capture.mjs
CAPTURE_ORIGIN=http://127.0.0.1:15331 PHASE=che-ascii NAME_KIND=ascii \
node tools/typography-audit/capture.mjs
CAPTURE_ORIGIN=http://127.0.0.1:15331 PHASE=che-mobile MOBILE=1 \
node tools/typography-audit/capture.mjs
```

HWE는 build의 세 변수를 `/hwe`, `/hwe/api/trpc`, `hwe:default`로 바꾸고,
audit에도 `PLAYWRIGHT_GAME_BASE_PATH=hwe PLAYWRIGHT_GAME_PROFILE=hwe:default`를
지정한다. 같은 dist를 쓰는 profile build는 직렬로 실행한다. 활성 공개 profile을
새로 배포하거나 서버 설정을 바꾸는 명령이 아니다.

| 환경 변수                    | 의미                                                              |
| ---------------------------- | ----------------------------------------------------------------- |
| `CAPTURE_ORIGIN`             | 이미 실행 중인 frontend origin                                    |
| `PHASE`                      | 결과 하위 디렉터리 이름                                           |
| `TYPOGRAPHY_OUTPUT_DIR`      | 기본 `test-results/typography-audit`                              |
| `TYPOGRAPHY_FONT_ROOT`       | 선택적 Pretendard cache: `source.css`와 CSS가 참조하는 woff2 파일 |
| `FRONTEND_PARITY_IMAGE_ROOT` | 기본 workspace의 `image/`                                         |
| `NAME_KIND`                  | 기본 `cjk`, 또는 `ascii`, `short4`, `mid7`                        |
| `WIDTHS`                     | 기본 `500,1000` CSS px                                            |
| `MOBILE`                     | `1`이면 실제 390×844 touch 기기에서 500/1000 화면 모드            |
| `SCENES`                     | 쉼표로 나눈 일부 scene만 실행; 전체 페이지 검증으로 보고하지 않음 |

각 실행은 현재 router의 `path` 목록과 전체 scene 목록의 대응을 먼저 검사한다.
font 로딩 실패, fixture/page 오류, 설명할 수 없는 computed 크기는 실패로 기록한다.
자동 축소는 `data-font-fit-max`와 10px 하한을 함께 검사한다. 원본 screenshot,
DOM, computed style, text range, viewport scale, 이미지 natural size/object-fit,
canvas font와 합성 응답이 scene별 파일로 남는다. 실패 manifest와 성공 수를 따로
확인한다. snapshot 개수만으로 성공이라고 판단하지 않는다.

`clipped`는 overflow를 가진 조상의 경계를 검사한다. overflow가 visible인 글자가
옆 칸을 침범하는 경우까지 자동 판정하지 못하므로 이름의 range와 element bounds,
screenshot도 비교한다. 긴 반각 이름의 기존 문제를 숨기려고 glyph mask를 늘리지
않는다. 별도의 Playwright interaction suite로 dropdown, dialog, hover/focus,
active, disabled 상태를 확인한다.

## 검증 경계

이 도구는 fixture production Chromium의 화면 근거다. 운영 DB/계정, 공개 HTTPS,
개인 CSS나 임의의 저장 HTML 전체를 검사했다는 뜻이 아니다. 감사 화면의 tab,
국가 회의실/기밀실, 동적 왕조 상세, 명령·인사 선택창을 별도 scene으로 포함한다.
새 사용자 페이지가 추가되면 router coverage 오류를 해결하며 scene과 fixture를
추가한다. 생성물은 Git에 넣지 않는다.
