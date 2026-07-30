# Caddy prefix 계약

## 활성 경로

| 서비스  | 공개 prefix | frontend |     API |
| ------- | ----------- | -------: | ------: |
| gateway | `/gateway/` |  `15000` | `15001` |
| che     | `/che/`     |  `15002` | `15003` |
| hwe     | `/hwe/`     |  `15014` | `15015` |

Upstream host는 `172.30.1.54`입니다. `kwe`, `pwe`, `twe`, `nya`, `pya`는
resource·profile 이름으로 사용할 수 있지만 활성 Caddy route가 아닙니다.

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
pnpm --filter @sammo-ts/gateway-frontend build
```

Game frontend는 profile별 값으로 build합니다.

```sh
VITE_APP_BASE_PATH=/che \
VITE_GAME_API_URL=/che/api/trpc \
VITE_GAME_SSE_URL=/che/api/events \
pnpm --filter @sammo-ts/game-frontend build
```

HWE는 `/che`를 `/hwe`로 바꿉니다. `VITE_*`는 browser bundle에 포함되는
공개값이므로 secret을 넣지 않습니다.

## 정적 자산

- Vite asset URL은 frontend base path를 포함합니다.
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
upstream 상태를 증명하지 않습니다.
