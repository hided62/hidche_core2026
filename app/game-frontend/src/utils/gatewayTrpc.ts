import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@sammo-ts/gateway-api';

const getSessionToken = (): string | null => {
    if (typeof window === 'undefined') {
        return null;
    }

    return window.localStorage.getItem('sammo-session-token');
};

export const gatewayTrpc = createTRPCProxyClient<AppRouter>({
    links: [
        httpBatchLink({
            url: import.meta.env.VITE_GATEWAY_API_URL ?? '/api/trpc',
            headers() {
                const token = getSessionToken();
                return token ? { 'x-session-token': token } : {};
            },
        }),
    ],
});
