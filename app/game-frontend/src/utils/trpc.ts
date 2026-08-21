import { trpcJsonBodyHttpClientOptions } from '@sammo-ts/common/http/trpcTransport';
import { REALTIME_ACCESS_GRANT_HEADER } from '@sammo-ts/common/realtime/types';
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@sammo-ts/game-api';
import { resolveBatchRealtimeAccessGrant } from './realtimeAccessGrant';
import { markGameServerContact } from './gameServerActivity';

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
            ...trpcJsonBodyHttpClientOptions,
            async fetch(input, init) {
                const result = await globalThis.fetch(input, init);
                markGameServerContact();
                return result;
            },
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
