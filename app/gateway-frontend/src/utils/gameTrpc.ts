import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { appRouter } from '@sammo-ts/game-api';

export type GameRouter = typeof appRouter;

const resolveProfileUrl = (template: string, profile: string): string =>
    template.replaceAll('{profile}', encodeURIComponent(profile));

export const createGameTrpc = (profile: string, port: number, gameToken?: string) => {
    const urlTemplate = import.meta.env.VITE_GAME_API_URL_TEMPLATE;
    const url = urlTemplate
        ? resolveProfileUrl(urlTemplate, profile)
        : `http://localhost:${port}/api/trpc`;
    return createTRPCProxyClient<GameRouter>({
        links: [
            httpBatchLink({
                url,
                headers: gameToken ? { authorization: `Bearer ${gameToken}` } : undefined,
            }),
        ],
    });
};
