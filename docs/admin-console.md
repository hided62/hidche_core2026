# 관리자 콘솔

Gateway 관리자 콘솔은 `/gateway/admin`에서 시작합니다. 공개 로비에서 관리자
역할 또는 `admin.*` 범위 권한이 확인된 사용자에게만 진입 링크를 표시하며,
실제 조회와 변경 권한은 각 Gateway API가 다시 검사합니다.

## 화면 구성

좌측 메뉴는 관리 책임을 다음과 같이 분리합니다.

| 메뉴          | 경로                      | 책임                                                                           |
| ------------- | ------------------------- | ------------------------------------------------------------------------------ |
| 운영 개요     | `/gateway/admin`          | 관리 영역 안내와 빠른 진입                                                     |
| 사용자 관리   | `/gateway/admin/users`    | 계정 조회·생성, 권한, 특수 접근·OAuth 유예, 제재, 아이콘 복구, 탈퇴 예약과 사용자별 이력 |
| 서버 관리     | `/gateway/admin/servers`  | profile 공개 정보, 계정 정책, 실행 상태와 게임 운영 동작                       |
| 버전 업데이트 | `/gateway/admin/releases` | profile DB 유지·초기화 배포, Gateway 릴리스·rollback과 작업 이력               |
| 공지 · 접속   | `/gateway/admin/system`   | 로비 공지와 관리자 세션 연결                                                   |
| 감사 로그     | `/gateway/admin/audit`    | 관리자 조치 결과, 대상과 사유 조회                                             |

기존 `/gateway/admin/server-operations` 링크는 query string을 보존한 채
`/gateway/admin/releases`로 이동합니다. 즐겨찾기와 이전 운영 보고서의 링크를
즉시 깨뜨리지 않기 위한 호환 경로입니다.

## 운영 경계

- 사용자 페이지는 사용자 한 명에 대한 계정 변경과 사용자별 감사 이력만
  표시합니다. 전체 감사 원장은 감사 로그에서 별도로 조회합니다.
- 서버 관리는 현재 실행 상태와 게임 운영 정책을 다룹니다. Git source 선택,
  migration, 시나리오 초기화와 rollback은 버전 업데이트에서 수행합니다.
- `DEPLOY`는 현재 game DB를 유지하고 migration/build를 적용합니다. `RESET`은
  현재 시즌 데이터를 새 시나리오로 교체하며 장기 보존 자료를 유지합니다.
- Gateway 릴리스는 profile 작업과 다른 전역 `admin.releases.manage` 권한을
  사용하며 외부 release-controller가 실행합니다.
- 브라우저의 메뉴 노출은 편의 기능입니다. 권한 판단의 기준은 서버가 인증
  session에서 해석한 capability입니다.

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
