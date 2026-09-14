# 게임 페이지의 돌아가기와 창 닫기

## 제품 계약

2026-09-14부터 게임 메인에서 연결되는 내부 페이지는 페이지 이름이나 `opener`가
아니라 **탭을 연 방식**으로 종료 동작을 결정합니다. 기존 Ref의 메인 복귀와 별도
창 종료 개념을 계승하면서, 직접 접속과 브라우저 새 탭 동작을 구분하는 Core UX 정책입니다.

| 진입 방식                                                             | 표시     | 버튼 결과                                         |
| --------------------------------------------------------------------- | -------- | ------------------------------------------------- |
| 현재 탭에서 페이지 이동                                               | 돌아가기 | 같은 탭의 게임 메인으로 이동                      |
| `newTab` 링크를 일반 클릭 또는 Enter로 실행                           | 창 닫기  | 새로 열린 탭 종료, 원래 탭 유지                   |
| Ctrl/Meta/Shift 클릭, 가운데 클릭, 브라우저 새 탭 열기, URL 직접 접속 | 돌아가기 | 해당 탭을 유지하고 게임 메인으로 이동             |
| 앱이 연 탭 안에서 페이지 이동 또는 새로고침                           | 창 닫기  | 같은 보조 탭 종료                                 |
| 브라우저가 앱의 새 창 열기를 차단                                     | 돌아가기 | 현재 탭에서 목적지를 열고 같은 탭의 메인으로 복귀 |

‘창 닫기’는 `window.close()`만 호출하며 메인 이동으로 대체하지 않습니다.
‘돌아가기’는 브라우저 history의 직전 페이지가 아닌 현재 게임 prefix의 `/`로 이동합니다.
버튼의 원래 위치·스타일·상하단 구성은 유지합니다. 전투 시뮬레이터에는 빠져 있던
페이지 종료 버튼을 상단에 추가했습니다. 게시판 조회·접근 실패 화면에도 복귀 버튼을 제공합니다.

## 구현

- `app/game-frontend/src/main.ts`에서 `installAuxiliaryNavigation()`을 설치합니다.
- `app/game-frontend/src/utils/auxiliaryNavigation.ts`는 게임 prefix 안의 `target="_blank"` 링크에
  대한 일반 클릭만 처리합니다. 따라서 공통·국가 메뉴, 모바일 메뉴, 설문 상태 제목과
  새 설문 알림도 동일한 진입 처리를 사용합니다.
- 앱이 실제로 연 빈 탭에 고유한 `window.name`을 지정하고 `opener`를 분리한 뒤
  목적지로 이동합니다. `noreferrer`도 새 문서의 referrer 정책으로 보존합니다.
- `app/game-frontend/src/composables/usePageExit.ts`가 표식 유무로 문구와 동작을 함께 결정합니다.
  이 표식은 UI 상태이며 인증·권한 근거가 아닙니다. URL, localStorage 또는
  sessionStorage를 표식으로 사용하지 않아 복사한 링크와 사용자가 연 탭에 전파하지 않습니다.
- 외부 웹사이트 및 다른 앱 prefix의 링크는 해당 앱의 탐색 정책을 따릅니다.
  게임 안의 대화상자·선택창 ‘닫기’는 해당 대화상자를 닫는 기존 동작입니다.
- 장수 선택의 경우 이미 장수가 있는 메인 진입 흐름에는 이 정책을 사용하고,
  아직 장수가 없는 가입 흐름의 복귀 경로는 유지합니다.

## 적용 화면

공통 메뉴: 천통국 베팅, 세력일람, 장수일람, 명장일람, 연감, 전투 시뮬레이터,
명예의전당, 왕조일람·상세, 접속량정보, 빙의일람, 설문조사.

국가 메뉴: 회의실·기밀실, 부대 편성, 외교부, 인사부, 내무부, 사령부, NPC 정책,
암행부, 토너먼트·베팅장, 세력 정보·도시·장수, 중원 정보, 현재 도시, 감찰부,
유산 관리, 내 정보, 금/쌀·유니크 경매장, 환경 설정.

후속 화면인 과거 플레이 기록 및 기존 장수의 장수 선택에도 같은 정책을 적용합니다.

## 검증

`e2e/mainNavigation.spec.ts`에서 메인의 실제 링크 클릭으로 팝업을 얻고,
상하단 종료, 원래 탭 URL 유지와 `context.pages()` 수를 검증합니다.
직접 접속·Ctrl 클릭·가운데 클릭, 같은 탭 이동, 보조 탭 내부 이동·새로고침을
구분합니다. 전체 메뉴 순회는 API 조회 실패 시에도 종료 동작을 제공하는지 확인합니다.
정상 데이터 렌더링은 기존 페이지별 fixture suite와 함께 검증합니다.

실행 예:

```sh
PLAYWRIGHT_FRONTEND_PORT=15261 PLAYWRIGHT_FRONTEND_MODE=production \
pnpm --filter @sammo-ts/game-frontend exec playwright test mainNavigation.spec.ts \
  --config e2e/playwright.config.mjs \
  --grep 'page exit policy|all main page exits|closes the survey popup'
```

브라우저의 종료 제한 근거:
[MDN Window.close](https://developer.mozilla.org/en-US/docs/Web/API/Window/close).
