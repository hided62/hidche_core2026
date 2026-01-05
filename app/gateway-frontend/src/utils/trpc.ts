import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@sammo-ts/gateway-api';

const getSessionToken = (): string | null => {
    if (typeof window === 'undefined') {
        return null;
    }
    return window.localStorage.getItem('sammo-session-token');
};

export const trpc = createTRPCProxyClient<AppRouter>({
    links: [
        httpBatchLink({
            url: '/api/trpc', // 실제 환경에 맞게 조정 필요
            headers() {
                const token = getSessionToken();
                return token ? { 'x-session-token': token } : {};
            },
        }),
    ],
});
