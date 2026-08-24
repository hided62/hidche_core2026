# 관리자 콘솔

Gateway 관리자 콘솔은 `/gateway/admin`에서 시작합니다. 공개 로비에서 관리자
역할 또는 `admin.*` 범위 권한이 확인된 사용자에게만 진입 링크를 표시하며,
실제 조회와 변경 권한은 각 Gateway API가 다시 검사합니다.

## 화면 구성

좌측 메뉴는 관리 책임을 다음과 같이 분리합니다.

| 메뉴            | 경로                                           | 책임                                                                      |
| --------------- | ---------------------------------------------- | ------------------------------------------------------------------------- |
| 운영 개요       | `/gateway/admin`                               | 현재 권한으로 접근할 수 있는 관리 영역 안내                               |
| 사용자 관리     | `/gateway/admin/users`                         | 계정 조회·생성, 권한, 특수 접근·OAuth 유예, 제재, 아이콘 복구와 탈퇴 예약 |
| 서버 관리       | `/gateway/admin/servers`                       | 접근 가능한 profile 목록                                                  |
| 서버 상태·설정  | `/gateway/admin/servers/:profileName`          | 해당 profile의 공개 정보, 계정 정책, 실행 상태와 게임 운영 동작           |
| 버전 업데이트   | `/gateway/admin/servers/:profileName/version`  | 현 DB를 보존하는 profile 코드·migration 배포                              |
| 시나리오 초기화 | `/gateway/admin/servers/:profileName/scenario` | 서버 지정 branch 최신 또는 고정 commit으로 현 시즌 DB와 시나리오 교체     |
| 게임 취소       | `/gateway/admin/servers/:profileName/cancel`   | 잘못 연 게임을 닫고 기록·유산 포인트를 취소 정책에 따라 원자적으로 정산   |
| Gateway 릴리스  | `/gateway/admin/releases`                      | Gateway control plane 배포와 rollback                                     |
| 공지 · 접속     | `/gateway/admin/system`                        | 로비 공지와 관리자 세션 연결                                              |
| 감사 로그       | `/gateway/admin/audit`                         | 관리자 조치 결과, 대상과 사유 조회                                        |

기존 `/gateway/admin/server-operations` 링크는 query string을 보존한 채
`/gateway/admin/servers`로 이동합니다. 즐겨찾기와 이전 운영 보고서의 링크를
즉시 깨뜨리지 않기 위한 호환 경로입니다.

## 운영 경계

- 사용자 페이지는 사용자 한 명에 대한 계정 변경과 사용자별 감사 이력만
  표시합니다. 전체 감사 원장은 감사 로그에서 별도로 조회합니다.
- 서버 관리는 profile별 하위 트리입니다. 상태·설정, DB 보존 버전 업데이트와
  시나리오 초기화가 같은 서버 아래의 상단 탭으로 노출됩니다. 현재 탭은 색상과
  `aria-current`로 구분하며 desktop과 mobile에서 본문보다 먼저 표시합니다.
- `profileName`은 `${profile}:${instanceKey}` 형식의 불변 기술 ID입니다.
  `che:default`의 `default`는 현재 시나리오가 아니라 기본 인스턴스 키입니다.
  route, 권한 scope, mutation payload, DB FK, process와 Redis namespace는 이 값을
  유지합니다. 화면·알림·확인 문구·작업 로그는 API의 `displayName`만 소비하여 기본
  인스턴스는 `체`, 비기본 인스턴스는 `체 [2]`처럼 구분합니다.
- 버전 업데이트와 시나리오 초기화 route는 URL의 `profileName`으로 대상 서버가
  이미 고정됩니다. 따라서 작업 화면에서 전체 profile 목록이나 중복 실행 상태를
  기다리지 않고 작업 form과 해당 서버의 operation 이력을 먼저 표시합니다. 상세
  runtime·빌드 상태는 상태 설정 탭에서 확인합니다.
- 버전 업데이트·시나리오 초기화·게임 취소 화면의 작업 이력은 요청·작업, 상태,
  보기의 3열 요약으로 표시합니다. `진행 중`, `완료`, `실패` 등 현재 상태와 로그를
  먼저 확인하고, 서버 표시명·작업 ID·소스·커밋·요청자·사유·완료 시각·오류 원문은
  각 작업의 `상세` 행에서 확인합니다. 상세 버튼은 `aria-expanded`와
  `aria-controls`로 연결되며 500px 화면에서도 페이지 가로 스크롤 없이 열립니다.
- 공통 좌측 메뉴는 `admin.profiles.listNavigation`으로 접근 가능한 profile의 이름과
  표시명만 읽습니다. 이 요청은 PM2 runtime 상태를 포함하는 본문용
  `admin.profiles.list`와 별도의 non-batch 요청으로 전송하되 한 페이지 안의 layout과
  작업 화면은 같은 in-flight 결과를 공유합니다. 상태 조회가 늦거나 중단되어도
  관리자 capability와 서버 메뉴를 함께 기다리게 하지 않습니다.
- `DEPLOY`는 현재 game DB를 유지하고 migration/build를 적용합니다. `RESET`은
  현재 시즌 데이터를 새 시나리오로 교체하며 장기 보존 자료를 유지합니다.
- `CANCEL_GAME`은 `RESET`과 다른 비가역 운영 작업입니다. `PREOPEN`, `RUNNING`,
  `PAUSED` 게임만 요청할 수 있고, migration 준비 후 profile process를 정지한
  다음 한 DB transaction에서 기록과 유산 포인트를 정산합니다. 성공한 profile은
  사용자 접근·턴 진행·운영자 재개가 모두 금지된 `CANCELLED`가 되며, 다시
  사용하려면 새 시나리오 초기화가 필요합니다.
- 취소 화면에서 기수 이력은 `버려진 게임`으로 남기거나 `ng_games` 행을 실제
  삭제할 수 있습니다. 플레이 장수의 `OldGeneral` 기록도 독립적으로 보존·삭제할
  수 있습니다. 버려진 기록은 원래 season을 감사 자료에만 보관하고 과거 플레이
  화면에서는 정식 기수 번호·왕조·승자 기록으로 표시하지 않습니다.
- 유산 포인트는 게임 오픈 시점(또는 기존 게임의 첫 활동 시점) 원금을 먼저
  고정합니다. 취소 시 게임 중 지출과 현재 잔액에 의존하지 않고
  `오픈 원금 + floor(게임 중 획득분 × 보전율 / 100)`으로 정산합니다. 따라서
  지출분은 항상 전액 돌아오며 신규·복귀 지급과 게임 중 보상도 관리자가 고른
  0~100% 보전율의 적용 대상입니다.
- 시나리오 초기화는 기본적으로 서버에 현재 게시된 commit을 사용하므로 Git
  업데이트가 필요하지 않습니다. 새 branch/commit과 함께 초기화하려면 초기화
  권한과 버전 배포 권한이 모두 필요합니다.
- 서버 지정 버전의 시나리오 catalog는 capability·operation polling batch와
  분리된 요청으로 읽습니다. API가 profile의 `currentScenario`를 표시하며 화면은
  그 항목을 기본 선택합니다. scenario ID `0`도 유효한 값이고, 초기 요청이
  실패하면 현재 버전 모드에서 다시 확인할 수 있습니다.
- 서버 상태의 `서버 리셋 기본 옵션`은 `GatewayProfile.meta.resetDefaults`에
  턴 간격, 동기화, 가상 장수, 연장, 가입 방식, 장수 생성 제한, NPC, 이미지,
  토너먼트와 유저 자동턴 기본값을 저장합니다. 시나리오 초기화 화면은 대상
  서버를 URL에서 결정한 뒤 이 메타를 별도 권한 검사로 읽어 폼에 적용합니다.
  턴 간격은 하루를 `12개월 × 턴 간격`의 정수 개 게임 연도로 나눌 수 있는
  120의 양의 약수만 허용하므로 3분과 8분도 유효합니다.
  유저 자동턴은 내정, 이동, 징병, 고급 징병, 훈련, 전투, 중신의 7개 동작을
  각각 보존해 RESET payload로 전달합니다.
  메타가 없거나 유효하지 않으면 기존 시스템 기본값을 사용합니다. 시나리오와
  예약·가오픈·정식 오픈 시각은 매 실행마다 선택하므로 서버 기본값에 포함하지
  않습니다.
- 서버 상태의 `다음 시즌 번호`는 위 리셋 옵션과 별도의
  `GatewayProfile.meta.nextSeasonIdx`이며 0 이상의 정수를 허용합니다. 이벤트
  기수는 0을 저장한 뒤 RESET하고, 이벤트 종료 뒤 정상 기수 번호를 다시 저장한
  다음 RESET합니다. 빈 값은 강제 번호를 해제하여 기존 게임의 season 또는 신규
  기본값 1을 사용한다는 뜻입니다.
- `첫 기수 번호`는 `GatewayProfile.meta.firstGameIdx`이며 기본값은 1입니다.
  RESET은 `GameHistory.status=COMPLETED`인 이력 수에 이 값을 더해 현재
  `WorldState.meta.gameIdx`를 확정합니다. `season`은 이벤트 분류와 연차를 위한 별도
  값이므로 계산에 참여하지 않고, `OPEN`·`ABANDONED` 이력도 세지 않습니다. 예를 들어
  첫 기수 번호가 0인 profile은 완료 이력이 없을 때 0기, 0기가 완료된 다음 RESET에서
  1기가 됩니다. 변경은 다음 RESET부터 적용되며 완료 이력이 생긴 뒤 값을 바꾸면 이후
  번호가 이동하므로 서버 최초 번호를 정할 때만 설정하는 것을 원칙으로 합니다.
- 같은 화면의 `실행 중 게임 옵션`은 리셋 기본값과 별개로 현재 기수 DB의 턴
  간격, 장수 생성 제한, 유저 자동턴 제한·동작을 읽어 표시합니다. 세 값은
  `admin.profiles.runtime:<name>` 권한과 3자 이상의 사유가 있을 때 하나의
  내구성 런타임 작업으로 적용됩니다. 현재 DB 값을 읽지 못하면 폼을 제출할 수
  없습니다. 존재하지 않는 설문 오픈 동작은 서버 상태 화면에 노출하지 않습니다.
- Gateway 릴리스는 profile 작업과 다른 전역 `admin.releases.manage` 권한을
  사용하며 외부 release-controller가 실행합니다. 선택한 릴리스 작업의 단계와
  명령 출력을 관리자 화면이 long polling으로 이어 받아 표시하며, 완료된 이력의
  로그도 다시 열 수 있습니다.
- 브라우저의 메뉴 노출은 편의 기능입니다. 권한 판단의 기준은 서버가 인증
  session에서 해석한 capability입니다.

## Profile 권한 분류

| capability                       | 허용 작업                                                  |
| -------------------------------- | ---------------------------------------------------------- |
| `admin.profiles.runtime:<name>`  | 시작·정지·일시정지·재개, 시간 조정과 현재 기수 게임 옵션   |
| `admin.profiles.settings:<name>` | 표시 정보·리셋 기본 옵션·Kakao 미인증 접근/장수 생성 유예  |
| `admin.profiles.deploy:<name>`   | DB를 유지하는 Git 버전 업데이트, 초기화와 새 버전 결합     |
| `admin.scenarios.reset:<name>`   | 서버 지정 branch 최신 또는 고정 commit으로 시나리오 초기화 |
| `admin.games.cancel:<name>`      | 진행 게임 취소, 기록 옵션과 유산 포인트 보전율 확정        |
| `admin.reset.schedule:<name>`    | 허용된 시나리오 초기화를 미래 시각에 예약                  |
| `admin.releases.manage`          | profile과 분리된 Gateway control plane 배포·rollback       |

기존 상태 화면의 `즉시 리셋`·`리셋 예약` 버튼은 실제 DB 초기화 operation과
다른 metadata action이어서 제거했습니다. 초기화와 예약은 시나리오 초기화 탭의
`GatewayOperation(type=RESET)`만 사용합니다.

`admin.games.cancel`은 `admin.profiles.runtime`, `admin.scenarios.reset`이나
기존 운영자 role에 포함되는 포괄 권한이 아닙니다. capability catalog의 별도
`CRITICAL` 권한이며 superuser 또는 명시적으로 범위를 받은 최고관리자만 사용합니다.
브라우저의 확인 입력과 confirm은 오조작 방지 UI이고, 실제 경계는 Gateway API의
capability 검사와 orchestrator의 상태·lease 검사입니다.

## Kakao 없는 특수 계정 접근

운영자 role(`superuser`, `admin`, `admin.*`)은 별도 grant 없이 모든 game
profile에 접근하고 장수를 생성할 수 있습니다. 일반 계정의 예외는 사용자 관리의
`특수 접근 부여`에서 다음 항목을 명시합니다.

- 종류: 특수 테스트(`TESTER`), 인증 수단 복구(`RECOVERY`), 기타(`OTHER`)
- profile: 비우면 전체, `che`면 모든 CHE 기수, `che:2`면 해당 기수만
- 장수 생성: 단순 기존 장수 접속과 신규 장수 생성 권한을 분리
- 만료: `RECOVERY`는 필수이며 현재 시각부터 최대 90일
- 사유: 부여·해제 모두 3자 이상이며 감사 원장에 기록

여러 grant가 있으면 현재 profile에 적용되는 유효 grant 중 하나라도 장수 생성을
허용할 때 생성이 가능합니다. 영구 grant가 하나라도 있으면 접근 만료는 없습니다.
Kakao 인증이 완료되면 특수 접근이 없어도 정상 접근하며, 계정 제재와 profile별
server restriction은 특수 접근보다 먼저 적용됩니다. 변경 시 user flush가 발행되어
다음 game token 발급부터 새 정책이 반영됩니다. 기존 Kakao 연결 계정도 비밀번호를
확인한 뒤 유효한 grant 기간에는 Kakao 공급자 검증 없이 로그인할 수 있으므로,
휴대폰 분실 복구에는 반드시 짧은 만료와 확인 사유를 사용합니다.

상세 배포·복구 절차는 [릴리스 운영 매뉴얼](./release-operations.md)을
따릅니다.
