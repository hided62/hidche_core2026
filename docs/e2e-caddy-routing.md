# Core2026 환경별 Caddy prefix 계약

## 환경과 ingress

| 환경          | 공개 주소·prefix                               | 접속·연결 계약                                                                                  |
| ------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Ref           | `dev-sam-ref.hided.net`                        | 개발 호스트 `172.30.1.54:3400`의 PHP 기준 구현입니다.                                           |
| 로컬 E2E      | `dev-sam-e2e.hided.net`                        | 외부 Caddy TLS → 개발 호스트 `172.30.1.54:14999` HTTP → Docker Caddy입니다.                     |
| 공개 개발     | `dev-sam2026.hided.net`                        | `ssh serv`의 `core2026-dev-sam2026`/`hidche_ng_my`입니다. 로컬 E2E `14999`와 다른 호스트입니다. |
| sam Core 운영 | `sam.hided.net/gateway/`와 일곱 profile prefix | `ssh serv`의 `core2026-sam-production`/`hidche_core2026_my`입니다.                              |
| sam PHP 운영  | `sam.hided.net/sam/`과 기존 PHP 경로           | `ssh serv`의 별도 `sam_hided_net` project입니다.                                                |

`dev-sam2026.hided.net`과 `sam.hided.net` Core prefix는 같은 Git 구현을 사용할 수
있지만 PostgreSQL, Redis, named volume, release queue와 active commit이 분리된
배포 환경입니다. 한 환경의 release/API/Chromium 결과를 다른 환경의 반영 근거로
사용하지 않습니다. 상위 `sam_rebuild` 작업공간에서는
`docs/docker-environment-routing.md`의 전체 결정 절차도 함께 따릅니다.

외부 Caddy는 E2E 호스트의 모든 경로를 `172.30.1.54:14999`로 전달하고 원래
`Host` header와 path prefix를 보존합니다. `handle_path`처럼 prefix를 제거하는
설정을 사용하지 않습니다. Docker Caddy가 아래 활성 경로를 frontend와 API로
분기합니다. 외부 상태 확인 경로는 `/gateway/api/healthz`입니다.

E2E Docker stack은 다음 비밀이 아닌 값을 사용합니다.

```dotenv
DOMAIN=dev-sam-e2e.hided.net
PUBLIC_SCHEME=https
CADDY_SITE_ADDRESS=http://dev-sam-e2e.hided.net
HTTP_PORT=14999
```

이 값에서 Gateway 공개 URL
`https://dev-sam-e2e.hided.net/gateway/`와 Kakao redirect URI
`https://dev-sam-e2e.hided.net/gateway/oauth/callback`을 파생합니다. 도메인을
바꾼 뒤에는 Caddy뿐 아니라 runtime도 재생성하여 process 환경을 갱신합니다.

## 로컬 E2E 활성 경로

| 서비스  | 공개 prefix | frontend |     API |
| ------- | ----------- | -------: | ------: |
| gateway | `/gateway/` |  `15000` | `15001` |
| che     | `/che/`     |  `15002` | `15003` |
| hwe     | `/hwe/`     |  `15014` | `15015` |

표의 port는 Docker 내부 Caddy가 연결하는 frontend/API listener입니다. 외부
Caddy가 이 port들에 직접 연결하지 않습니다. `kwe`, `pwe`, `twe`, `nya`,
`pya`는 로컬 E2E에서 resource·profile 이름으로 사용할 수 있지만 활성 Caddy
route가 아닙니다. `sam.hided.net`의 별도 운영 Core stack에는 이 다섯 profile도
활성 prefix이므로 환경별 계약을 섞지 않습니다.

Caddy는 prefix를 보존해 upstream에 전달합니다. 앱은 root 배포를 가정하지
않고 frontend base, tRPC, SSE, upload와 direct navigation에 같은 prefix를
사용합니다. `/gateway`, `/che`, `/hwe`는 trailing slash 경로로 redirect합니다.

## Backend

Gateway API:

```sh
GATEWAY_API_HOST=0.0.0.0
GATEWAY_API_PORT=15001
GATEWAY_TRPC_PATH=/gateway/api/trpc
```

CHE:

```sh
GAME_API_HOST=0.0.0.0
GAME_API_PORT=15003
GAME_TRPC_PATH=/che/api/trpc
GAME_API_EVENTS_PATH=/che/api/events
```

HWE:

```sh
GAME_API_HOST=0.0.0.0
GAME_API_PORT=15015
GAME_TRPC_PATH=/hwe/api/trpc
GAME_API_EVENTS_PATH=/hwe/api/events
```

## Frontend build

Gateway:

```sh
VITE_APP_BASE_PATH=/gateway \
VITE_GATEWAY_API_URL=/gateway/api/trpc \
VITE_GAME_API_URL_TEMPLATE='/{profile}/api/trpc' \
VITE_GAME_WEB_URL_TEMPLATE='/{profile}/' \
VITE_PREVIEW_ALLOWED_HOSTS=dev-sam-e2e.hided.net \
pnpm --filter @sammo-ts/gateway-frontend build
```

Game frontend는 profile별 값으로 build합니다.

```sh
VITE_APP_BASE_PATH=/che \
VITE_GAME_API_URL=/che/api/trpc \
VITE_GAME_SSE_URL=/che/api/events \
VITE_PREVIEW_ALLOWED_HOSTS=dev-sam-e2e.hided.net \
pnpm --filter @sammo-ts/game-frontend build
```

HWE는 `/che`를 `/hwe`로 바꿉니다. `VITE_*`는 browser bundle에 포함되는
공개값이므로 secret을 넣지 않습니다.

## 정적 자산

- Vite asset URL은 frontend base path를 포함합니다.
- Gateway와 game production build는 공개 코드의 디버깅을 위한 source map을
  생성하며, frontend 배포 산출물에는 생성된 `.map` 파일도 포함합니다.
- Router direct navigation과 새로고침은 SPA fallback으로 frontend에
  전달됩니다.
- API와 events matcher는 frontend fallback보다 먼저 적용합니다.
- `/image/*`는 Caddy가 별도 파일 시스템에서 제공합니다. 앱에서 rewrite,
  proxy 또는 복제하지 않습니다.

## 검증

앱을 실행하지 않는 검사는 built HTML·JS의 base와 URL, listener config,
Caddy matcher를 정적으로 확인합니다. Mock upstream을 사용할 때는 exact
path와 wildcard path를 모두 검사합니다.

실제 E2E는 다음을 확인합니다.

1. `/gateway`, `/che`, `/hwe` redirect
2. 각 prefix root와 deep link의 200 응답
3. hashed asset과 `/image/*`
4. tRPC batch와 error response
5. SSE 연결과 reconnect URL
6. 로그인 후 gateway→game token 인계
7. 새로고침 뒤 session·route 복구

Local proxy·mock 성공은 외부 DNS, TLS, Caddy process, host firewall와
upstream 상태를 증명하지 않습니다. 도메인 전환 시에는 route 응답과 별도로
OAuth 시작 응답의 redirect URI 및 callback 복귀 호스트도 확인합니다.
