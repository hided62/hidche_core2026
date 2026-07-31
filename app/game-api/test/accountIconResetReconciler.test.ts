import { describe, expect, it, vi } from 'vitest';

import type { DatabaseClient } from '../src/context.js';
import { InMemoryTurnDaemonTransport } from '../src/daemon/inMemoryTransport.js';
import { AccountIconResetReconciler } from '../src/services/accountIconResetReconciler.js';

const reset = (userId: string) => ({
    userId,
    resetRevision: '2026-07-31T09:00:00.001Z',
    current: {
        revision: '2026-07-31T09:00:00.002Z',
        picture: 'newer.png',
        imageServer: 1,
    },
});

describe('AccountIconResetReconciler', () => {
    it('replays stale resets, skips newer watermarks, and bootstraps matching post-reset tuples', async () => {
        const db = {
            general: {
                findMany: vi.fn(async () => [
                    {
                        id: 1,
                        userId: 'needs-reset',
                        picture: 'old.png',
                        imageServer: 1,
                        meta: { accountIconUpdatedAt: '2026-07-31T08:59:59.999Z' },
                    },
                    {
                        id: 2,
                        userId: 'already-newer',
                        picture: 'newer.png',
                        imageServer: 1,
                        meta: { accountIconUpdatedAt: '2026-07-31T09:00:00.002Z' },
                    },
                    {
                        id: 3,
                        userId: 'legacy-watermark',
                        picture: 'newer.png',
                        imageServer: 1,
                        meta: {},
                    },
                ]),
            },
            inputEvent: {
                findMany: vi.fn(async () => []),
            },
        } as unknown as DatabaseClient;
        const source = {
            listResets: vi.fn(async () => [reset('needs-reset'), reset('already-newer'), reset('legacy-watermark')]),
        };
        const transport = new InMemoryTurnDaemonTransport();
        const reconciler = new AccountIconResetReconciler(db, source, transport, 30_000);

        await reconciler.reconcileOnce();

        expect(source.listResets).toHaveBeenCalledWith(['needs-reset', 'already-newer', 'legacy-watermark']);
        expect(transport.commands.map(({ command }) => command)).toEqual([
            {
                type: 'adjustGeneralIcon',
                requestId: 'general:adjustIcon:needs-reset:2026-07-31T09:00:00.001Z',
                userId: 'needs-reset',
                picture: 'default.jpg',
                imageServer: 0,
                iconRevision: '2026-07-31T09:00:00.001Z',
            },
            {
                type: 'adjustGeneralIcon',
                requestId: 'general:adjustIcon:legacy-watermark:2026-07-31T09:00:00.002Z',
                userId: 'legacy-watermark',
                picture: 'newer.png',
                imageServer: 1,
                iconRevision: '2026-07-31T09:00:00.002Z',
            },
        ]);
        expect(reconciler.getHealth()).toMatchObject({ lastSuccessAt: expect.any(String), lastError: null });
    });

    it('requeues terminal events and isolates a persistent user failure from later users', async () => {
        const db = {
            general: {
                findMany: vi.fn(async () =>
                    ['terminal', 'broken', 'later'].map((userId, index) => ({
                        id: index + 1,
                        userId,
                        picture: 'old.png',
                        imageServer: 1,
                        meta: {},
                    }))
                ),
            },
            inputEvent: {
                findMany: vi.fn(async ({ where }: { where: { OR: Array<{ requestId: unknown }> } }) => {
                    const first = where.OR[0]?.requestId;
                    if (first === 'general:adjustIcon:broken:2026-07-31T09:00:00.001Z') {
                        throw new Error('broken event lookup');
                    }
                    if (first === 'general:adjustIcon:terminal:2026-07-31T09:00:00.001Z') {
                        return [
                            {
                                requestId: first,
                                status: 'FAILED',
                                eventType: 'adjustGeneralIcon',
                                payload: {
                                    type: 'adjustGeneralIcon',
                                    requestId: first,
                                    userId: 'terminal',
                                    picture: 'default.jpg',
                                    imageServer: 0,
                                    iconRevision: '2026-07-31T09:00:00.001Z',
                                },
                            },
                        ];
                    }
                    return [];
                }),
            },
        } as unknown as DatabaseClient;
        const source = { listResets: vi.fn(async () => ['terminal', 'broken', 'later'].map(reset)) };
        const transport = new InMemoryTurnDaemonTransport();
        const reconciler = new AccountIconResetReconciler(db, source, transport, 30_000);

        await expect(reconciler.reconcileOnce()).rejects.toThrow('1 account icon reset reconciliation');
        expect(transport.commands.map(({ command }) => command.requestId)).toEqual([
            'general:adjustIcon:terminal:2026-07-31T09:00:00.001Z:retry:1',
            'general:adjustIcon:later:2026-07-31T09:00:00.001Z',
        ]);
        expect(reconciler.getHealth()).toMatchObject({ lastErrorAt: expect.any(String) });
    });
});
