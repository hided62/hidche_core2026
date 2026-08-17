import { trpcJsonBodyHttpClientOptions } from '@sammo-ts/common';
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@sammo-ts/game-api';

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
            headers() {
                const token = getGameToken();
                return token ? { authorization: `Bearer ${token}` } : {};
            },
        }),
    ],
});
