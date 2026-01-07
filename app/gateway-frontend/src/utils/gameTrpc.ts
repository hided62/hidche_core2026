import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { appRouter } from '@sammo-ts/game-api';

export type GameRouter = typeof appRouter;

export const createGameTrpc = (port: number) => {
    return createTRPCProxyClient<GameRouter>({
        links: [
            httpBatchLink({
                url: `http://localhost:${port}/api/trpc`, // 실제 환경에서는 도메인/경로 조정 필요
            }),
        ],
    });
};
