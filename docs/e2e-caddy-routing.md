# dev-sam-e2e Caddy 라우팅 계약

`dev-sam-e2e.hided.net`은 URI prefix를 제거하지 않고 frontend/API upstream에
전달한다. 따라서 Caddy matcher, frontend build base, 브라우저 API URL,
backend listen path가 같은 prefix를 사용해야 한다.

## Caddy 설정

Caddy path matcher의 `/gateway`는 `/gateway/`나 `/gateway/api/trpc`를
포함하지 않는다. 각 앱의 exact path는 trailing slash로 redirect하고 하위
경로는 wildcard matcher로 받아야 한다. API matcher는 frontend matcher보다
먼저 둔다.

```caddyfile
redir /gateway /gateway/ 308
@gatewayApi path /gateway/api /gateway/api/*
handle @gatewayApi {
        reverse_proxy http://172.30.1.54:15001 {
                header_up X-Real-IP {remote_host}
                header_down -Strict-Transport-Security
        }
}
handle /gateway/* {
        reverse_proxy http://172.30.1.54:15000 {
                header_up X-Real-IP {remote_host}
                header_down -Strict-Transport-Security
        }
}

redir /che /che/ 308
@cheApi path /che/api /che/api/*
handle @cheApi {
        reverse_proxy http://172.30.1.54:15003 {
                header_up X-Real-IP {remote_host}
                header_down -Strict-Transport-Security
        }
}
handle /che/* {
        reverse_proxy http://172.30.1.54:15002 {
                header_up X-Real-IP {remote_host}
                header_down -Strict-Transport-Security
        }
}

redir /kwe /kwe/ 308
@kweApi path /kwe/api /kwe/api/*
handle @kweApi {
        reverse_proxy http://172.30.1.54:15005 {
                header_up X-Real-IP {remote_host}
                header_down -Strict-Transport-Security
        }
}
handle /kwe/* {
        reverse_proxy http://172.30.1.54:15004 {
                header_up X-Real-IP {remote_host}
                header_down -Strict-Transport-Security
        }
}

redir /twe /twe/ 308
@tweApi path /twe/api /twe/api/*
handle @tweApi {
        reverse_proxy http://172.30.1.54:15007 {
                header_up X-Real-IP {remote_host}
                header_down -Strict-Transport-Security
        }
}
handle /twe/* {
        reverse_proxy http://172.30.1.54:15006 {
                header_up X-Real-IP {remote_host}
                header_down -Strict-Transport-Security
        }
}

redir /hwe /hwe/ 308
@hweApi path /hwe/api /hwe/api/*
handle @hweApi {
        reverse_proxy http://172.30.1.54:15015 {
                header_up X-Real-IP {remote_host}
                header_down -Strict-Transport-Security
        }
}
handle /hwe/* {
        reverse_proxy http://172.30.1.54:15014 {
                header_up X-Real-IP {remote_host}
                header_down -Strict-Transport-Security
        }
}
```

기존 `/image/*` handler는 앱 route 밖에 그대로 둔다. 위 블록은 URI를
strip하지 않으므로 backend의 tRPC/SSE path도 public path 전체를 사용한다.

## build/runtime 환경값

| 프로세스 | 포트 | 필수 경로 환경값 |
| --- | ---: | --- |
| gateway frontend | 15000 | `VITE_APP_BASE_PATH=/gateway/`, `VITE_GATEWAY_API_URL=/gateway/api/trpc`, `VITE_GAME_API_URL_TEMPLATE=/{profile}/api/trpc`, `VITE_GAME_WEB_URL_TEMPLATE=/{profile}/` |
| gateway API | 15001 | `GATEWAY_API_HOST=0.0.0.0`, `GATEWAY_API_PORT=15001`, `GATEWAY_TRPC_PATH=/gateway/api/trpc` |
| che frontend | 15002 | `VITE_APP_BASE_PATH=/che/`, `VITE_GATEWAY_API_URL=/gateway/api/trpc`, `VITE_GAME_API_URL=/che/api/trpc`, `VITE_GAME_SSE_URL=/che/api/events`, `VITE_GAME_ASSET_URL=/image`, `VITE_GAME_PROFILE=che` |
| che API | 15003 | `GAME_API_HOST=0.0.0.0`, `GAME_API_PORT=15003`, `GAME_TRPC_PATH=/che/api/trpc`, `GAME_API_EVENTS_PATH=/che/api/events`, `GAME_UPLOAD_PATH=/che/api/uploads`, `PROFILE=che` |
| kwe frontend | 15004 | `VITE_APP_BASE_PATH=/kwe/`, `VITE_GATEWAY_API_URL=/gateway/api/trpc`, `VITE_GAME_API_URL=/kwe/api/trpc`, `VITE_GAME_SSE_URL=/kwe/api/events`, `VITE_GAME_ASSET_URL=/image`, `VITE_GAME_PROFILE=kwe` |
| kwe API | 15005 | `GAME_API_HOST=0.0.0.0`, `GAME_API_PORT=15005`, `GAME_TRPC_PATH=/kwe/api/trpc`, `GAME_API_EVENTS_PATH=/kwe/api/events`, `GAME_UPLOAD_PATH=/kwe/api/uploads`, `PROFILE=kwe` |
| twe frontend | 15006 | `VITE_APP_BASE_PATH=/twe/`, `VITE_GATEWAY_API_URL=/gateway/api/trpc`, `VITE_GAME_API_URL=/twe/api/trpc`, `VITE_GAME_SSE_URL=/twe/api/events`, `VITE_GAME_ASSET_URL=/image`, `VITE_GAME_PROFILE=twe` |
| twe API | 15007 | `GAME_API_HOST=0.0.0.0`, `GAME_API_PORT=15007`, `GAME_TRPC_PATH=/twe/api/trpc`, `GAME_API_EVENTS_PATH=/twe/api/events`, `GAME_UPLOAD_PATH=/twe/api/uploads`, `PROFILE=twe` |
| hwe frontend | 15014 | `VITE_APP_BASE_PATH=/hwe/`, `VITE_GATEWAY_API_URL=/gateway/api/trpc`, `VITE_GAME_API_URL=/hwe/api/trpc`, `VITE_GAME_SSE_URL=/hwe/api/events`, `VITE_GAME_ASSET_URL=/image`, `VITE_GAME_PROFILE=hwe` |
| hwe API | 15015 | `GAME_API_HOST=0.0.0.0`, `GAME_API_PORT=15015`, `GAME_TRPC_PATH=/hwe/api/trpc`, `GAME_API_EVENTS_PATH=/hwe/api/events`, `GAME_UPLOAD_PATH=/hwe/api/uploads`, `PROFILE=hwe` |

`VITE_*` 값은 frontend build-time 값이다. frontend 프로세스를 시작할 때만
설정해서는 이미 생성된 bundle이 바뀌지 않는다. Caddy가 prefix를 보존하므로
`handle_path`로 바꾸거나 upstream에서 다시 strip하면 위 backend path와
불일치한다.

## 앱을 구동하지 않는 검증

다음 항목을 독립적으로 확인한다.

1. Caddy config를 `caddy validate`/`caddy adapt`로 검증한다.
2. 각 upstream 대신 요청 URI와 listen port를 돌려주는 mock HTTP server를
   붙여 public path가 올바른 port로 전달되고 prefix가 보존되는지 확인한다.
3. frontend를 임시 output directory에 build하고 `index.html`의 module/CSS
   URL이 각각 `/gateway/`, `/che/`, `/kwe/`, `/twe/`, `/hwe/`로 시작하는지 확인한다.
4. bundle에서 외부 API/SSE URL과 `/image` asset base를 확인한다.

저장소의 `tools/e2e-routing-check/Caddyfile`은 18080에서 public Caddy
matcher를 재현하고, 19000번대 mock upstream이 선택된 service와 전달받은
URI를 응답한다. core2026 프로세스나 DB/Redis 없이 matcher 우선순위와
prefix 보존 여부를 반복 검증할 수 있다.

이 검증은 proxy/build 계약을 확인하지만 실제 DB, Redis, 인증과 게임 동작을
검증하지는 않는다.
