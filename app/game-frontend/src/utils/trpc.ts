import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@sammo-ts/game-api';
import { REALTIME_ACCESS_GRANT_HEADER } from '@sammo-ts/common';
import { resolveBatchRealtimeAccessGrant } from './realtimeAccessGrant';

const getGameToken = (): string | null => {
    if (typeof window === 'undefined') {
        return null;
    }

    return window.localStorage.getItem('sammo-game-token');
};

export const trpc = createTRPCProxyClient<AppRouter>({
    links: [
        httpBatchLink({
            url: import.meta.env.VITE_GAME_API_URL ?? '/api/trpc',
            headers({ opList }) {
                const token = getGameToken();
                const refreshGrant = resolveBatchRealtimeAccessGrant(opList);
                return {
                    ...(token ? { authorization: `Bearer ${token}` } : {}),
                    ...(refreshGrant ? { [REALTIME_ACCESS_GRANT_HEADER]: refreshGrant } : {}),
                };
            },
        }),
    ],
});
