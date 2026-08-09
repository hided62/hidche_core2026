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
| 시나리오 초기화 | `/gateway/admin/servers/:profileName/scenario` | 현재 배포 버전 또는 새 버전으로 현 시즌 DB와 시나리오 교체                |
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
- 버전 업데이트와 시나리오 초기화 route는 URL의 `profileName`으로 대상 서버가
  이미 고정됩니다. 따라서 작업 화면에서 전체 profile 목록이나 중복 실행 상태를
  기다리지 않고 작업 form과 해당 서버의 operation 이력을 먼저 표시합니다. 상세
  runtime·빌드 상태는 상태 설정 탭에서 확인합니다.
- `DEPLOY`는 현재 game DB를 유지하고 migration/build를 적용합니다. `RESET`은
  현재 시즌 데이터를 새 시나리오로 교체하며 장기 보존 자료를 유지합니다.
- 시나리오 초기화는 기본적으로 서버에 현재 게시된 commit을 사용하므로 Git
  업데이트가 필요하지 않습니다. 새 branch/commit과 함께 초기화하려면 초기화
  권한과 버전 배포 권한이 모두 필요합니다.
- Gateway 릴리스는 profile 작업과 다른 전역 `admin.releases.manage` 권한을
  사용하며 외부 release-controller가 실행합니다.
- 브라우저의 메뉴 노출은 편의 기능입니다. 권한 판단의 기준은 서버가 인증
  session에서 해석한 capability입니다.

## Profile 권한 분류

| capability                       | 허용 작업                                                  |
| -------------------------------- | ---------------------------------------------------------- |
| `admin.profiles.runtime:<name>`  | 시작·정지·일시정지·재개와 시간 조정                        |
| `admin.profiles.settings:<name>` | 표시색·표시명·인게임 공지·Kakao 미인증 접근/장수 생성 유예 |
| `admin.profiles.deploy:<name>`   | DB를 유지하는 Git 버전 업데이트, 초기화와 새 버전 결합     |
| `admin.scenarios.reset:<name>`   | 현재 배포 버전으로 시나리오 초기화                         |
| `admin.reset.schedule:<name>`    | 허용된 시나리오 초기화를 미래 시각에 예약                  |
| `admin.profiles.manage:<name>`   | 기존 역할 호환용 포괄 권한                                 |
| `admin.releases.manage`          | profile과 분리된 Gateway control plane 배포·rollback       |

기존 상태 화면의 `즉시 리셋`·`리셋 예약` 버튼은 실제 DB 초기화 operation과
다른 metadata action이어서 제거했습니다. 초기화와 예약은 시나리오 초기화 탭의
`GatewayOperation(type=RESET)`만 사용합니다.

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
