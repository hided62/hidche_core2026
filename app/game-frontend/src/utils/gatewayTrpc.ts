import { trpcJsonBodyHttpClientOptions } from '@sammo-ts/common/http/trpcTransport';
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@sammo-ts/gateway-api';
import { gameFrontendRuntimeConfig } from '../config/runtimeConfig';

const getSessionToken = (): string | null => {
    if (typeof window === 'undefined') {
        return null;
    }

    return window.localStorage.getItem('sammo-session-token');
};

export const gatewayTrpc = createTRPCProxyClient<AppRouter>({
    links: [
        httpBatchLink({
            url: gameFrontendRuntimeConfig.gatewayApiUrl,
            ...trpcJsonBodyHttpClientOptions,
            headers() {
                const token = getSessionToken();
                return token ? { 'x-session-token': token } : {};
            },
        }),
    ],
});
