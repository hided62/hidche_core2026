import { describe, expect, it } from 'vitest';

import type { GameApiContext, GameProfile, WorldStateRow } from '../src/context.js';
import { InMemoryTurnDaemonTransport } from '../src/daemon/inMemoryTransport.js';
import { appRouter } from '../src/router.js';

const profile: GameProfile = {
    id: 'che',
    scenario: 'default',
    name: 'che:default',
};

const buildContext = (options?: {
    state?: WorldStateRow | null;
    transport?: InMemoryTurnDaemonTransport;
}): GameApiContext => {
    const transport = options?.transport ?? new InMemoryTurnDaemonTransport();
    const db = {
        worldState: {
            findFirst: async () => options?.state ?? null,
        },
        general: {
            findUnique: async () => null,
        },
        city: {
            findUnique: async () => null,
        },
        nation: {
            findUnique: async () => null,
        },
    };
    return {
        db,
        turnDaemon: transport,
        profile,
        auth: null,
    };
};

describe('appRouter', () => {
    it('queues turn daemon run commands', async () => {
        const transport = new InMemoryTurnDaemonTransport();
        const caller = appRouter.createCaller(buildContext({ transport }));
        const response = await caller.turnDaemon.run({ reason: 'manual' });

        expect(response.accepted).toBe(true);
        expect(transport.commands).toHaveLength(1);
        expect(transport.commands[0]?.command.type).toBe('run');
        expect(transport.commands[0]?.requestId).toBe(response.requestId);
    });

    it('returns world state snapshots', async () => {
        const state: WorldStateRow = {
            scenarioCode: 'default',
            currentYear: 1,
            currentMonth: 2,
            tickSeconds: 600,
            config: { seed: 123 },
            meta: { label: 'sample' },
            updatedAt: new Date('2026-01-01T00:00:00Z'),
        };

        const caller = appRouter.createCaller(buildContext({ state }));
        const response = await caller.world.getState();

        expect(response?.scenarioCode).toBe('default');
        expect(response?.currentYear).toBe(1);
        expect(response?.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('returns status from transport', async () => {
        const transport = new InMemoryTurnDaemonTransport({
            state: 'paused',
            running: false,
            paused: true,
            queueDepth: 2,
        });

        const caller = appRouter.createCaller(buildContext({ transport }));
        const response = await caller.turnDaemon.status();

        expect(response?.state).toBe('paused');
        expect(response?.queueDepth).toBe(2);
    });
});
