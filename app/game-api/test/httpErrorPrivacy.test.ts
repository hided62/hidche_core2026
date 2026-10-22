import fastify from 'fastify';
import { TRPCError } from '@trpc/server';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { describe, expect, it } from 'vitest';
import { router as gameRouter, sessionActivityProcedure } from '../src/trpc.js';

const internalFailure = () => {
    throw new Error('synthetic-db-secret', { cause: new Error('synthetic-cause-secret') });
};
const badInput = () => {
    throw new TRPCError({
        code: 'BAD_REQUEST',
        message: '잘못된 입력입니다.',
        cause: new Error('synthetic-private-cause'),
    });
};

describe('public HTTP error privacy', () => {
    it('the real router factory hides internal errors and all stacks while preserving validation messages', async () => {
        const app = fastify();
        await app.register(fastifyTRPCPlugin, {
            prefix: '/game',
            trpcOptions: {
                router: gameRouter({
                    internal: sessionActivityProcedure.query(internalFailure),
                    invalid: sessionActivityProcedure.query(badInput),
                }),
                createContext: () => ({}),
            },
        });
        try {
            const address = await app.listen({ host: '127.0.0.1', port: 0 });
            for (const prefix of ['game']) {
                for (const procedure of ['internal', 'invalid']) {
                    const response = await fetch(`${address}/${prefix}/${procedure}`);
                    const body = (await response.json()) as {
                        error: { message: string; data: { code: string; stack?: string } };
                    };
                    expect(response.status).toBe(procedure === 'internal' ? 500 : 400);
                    expect(body.error.message).toBe(
                        procedure === 'internal' ? 'Internal server error' : '잘못된 입력입니다.'
                    );
                    expect(body.error.data.stack).toBeUndefined();
                    expect(JSON.stringify(body)).not.toContain('synthetic-');
                }
            }
        } finally {
            await app.close();
        }
    });
});
