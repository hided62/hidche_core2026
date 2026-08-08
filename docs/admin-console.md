# 관리자 콘솔

Gateway 관리자 콘솔은 `/gateway/admin`에서 시작합니다. 공개 로비에서 관리자
역할 또는 `admin.*` 범위 권한이 확인된 사용자에게만 진입 링크를 표시하며,
실제 조회와 변경 권한은 각 Gateway API가 다시 검사합니다.

## 화면 구성

좌측 메뉴는 관리 책임을 다음과 같이 분리합니다.

| 메뉴          | 경로                      | 책임                                                                           |
| ------------- | ------------------------- | ------------------------------------------------------------------------------ |
| 운영 개요     | `/gateway/admin`          | 관리 영역 안내와 빠른 진입                                                     |
| 사용자 관리   | `/gateway/admin/users`    | 계정 조회·생성, 권한, OAuth 유예, 제재, 아이콘 복구, 탈퇴 예약과 사용자별 이력 |
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

상세 배포·복구 절차는 [릴리스 운영 매뉴얼](./release-operations.md)을
따릅니다.
