# Gateway와 게임 공통 메뉴 설정

Gateway 상단 메뉴와 profile 게임 화면의 공통 메뉴는 하나의 JSON 설정을
공유합니다. 저장소 기본값은 `resources/navigation.json`이고 운영 runtime은
`CORE_NAVIGATION_CONFIG_FILE`이 가리키는 파일을 우선합니다. Docker 운영 구성의
기본 경로는 영속 volume 안의 `/srv/data/navigation.json`입니다.

## 반영 경계

`GET /gateway/api/navigation`과 `navigation.get`은 인증 없이 현재 파일을 요청마다
읽고 schema를 검증합니다. REST 응답은 `Cache-Control: public, max-age=3600,
must-revalidate`와 JSON 내용 기반 `ETag`를 제공합니다. 브라우저와 공유 캐시는 한
시간 동안 저장된 응답을 재사용하고, 만료 뒤에는 조건부 요청으로 변경 여부를
확인하여 같으면 `304 Not Modified`를 받습니다. `immutable`이나
`stale-while-revalidate`는 사용하지 않아 stale 응답의 허용 범위를 한 시간보다
늘리지 않습니다. tRPC `navigation.get`에는 이 HTTP cache 계약을 적용하지 않습니다.

Gateway와 게임 frontend는 화면을 처음 열 때 REST API를 조회합니다. 운영 JSON을
저장한 뒤 일반 새로고침에서 보이는 메뉴는 캐시 때문에 최대 한 시간 이전 값일 수
있으며, 캐시를 우회하는 강력 새로고침은 즉시 재검증할 수 있습니다. frontend
재빌드나 profile DB 초기화는 필요하지 않고, 이미 열린 화면을 서버가 강제로
바꾸지는 않습니다.

운영 파일이 아직 없으면 저장소 기본값을 사용합니다. Docker entrypoint는 최초
기동 때만 저장소 기본값을 영속 경로로 복사하고, 이미 존재하는 운영 파일은 배포나
container 재생성 때 덮어쓰지 않습니다. 파일을 읽을 수 없거나 schema가 틀리면
API는 오류를 반환하고 frontend는 빌드에 포함된 안전한 기본 메뉴를 표시합니다.

## 편집 형식

최상위 `version`은 현재 `1`입니다.

- `gateway.brand`: Gateway 브랜드 문구와 내부 `to`
- `gateway.items`: `id`, `label`, `href`, 선택적인 `newTab`
- `game.items`: `link`, `group`, `split` 항목
- `link`: `to`, `href`, `action` 가운데 정확히 하나만 사용
- `divider`: dropdown 구분선이며 고유한 `id`만 사용
- `showWhen: npc-enabled`: NPC 모드에서만 노출
- `highlightWhen: nation-betting|vote`: 해당 실시간 상태일 때 기존 강조색 적용
- `action: show-version`: 현재 지원하는 유일한 로컬 동작으로 버전 정보 dialog 표시

`to`는 profile base path를 보존하는 Vue Router 내부 경로입니다. `/xe`, `/wiki`
같이 Caddy가 소유한 외부 경로는 `href`를 사용합니다. URL은 `/`, `//`,
`https://`, `http://`로 시작하는 값만 허용하며 `javascript:` 같은 실행 URL은
거부합니다. 브라우저 식별과 자동 검증에 쓰이는 `id`는 영문 소문자, 숫자와
하이픈만 사용합니다.

## 운영 변경과 복구

1. `/srv/data/navigation.json`을 별도 위치에 복사해 되돌릴 파일을 확보합니다.
2. 임시 파일에서 편집하고 `jq empty`로 JSON 문법을 확인합니다.
3. 임시 파일을 운영 경로로 같은 filesystem 안에서 교체합니다.
4. `GET /gateway/api/navigation`이 성공하고 `Cache-Control`, `ETag`가 있는지
   확인합니다. 같은 `ETag`를 `If-None-Match`로 보내 `304`도 확인합니다.
5. Gateway desktop/mobile과 실제 profile 화면을 강력 새로고침해 순서, 링크,
   dropdown과 hover/focus를 확인합니다.

API 검증이 실패하면 직전 복사본을 원래 경로로 되돌립니다. 저장소 기본값으로
완전히 복구하려면 현재 배포 commit의 `resources/navigation.json`을 운영 경로에
복사합니다. 이 작업은 PostgreSQL, Redis, profile release나 현재 시즌을 변경하지
않습니다.

개발 검증은 다음 명령을 사용합니다.

```sh
pnpm --filter @sammo-ts/gateway-api test -- runtimeNavigationConfig.test.ts
pnpm --filter @sammo-ts/gateway-frontend test:e2e:operations --grep 'Gateway 상단 메뉴|Gateway 모바일|JSON 응답'
```
