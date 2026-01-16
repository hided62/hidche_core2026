import { describe, expect, it } from 'vitest';

import type { DatabaseClient, GameApiContext, GameProfile, WorldStateRow } from '../src/context.js';
import type { RedisConnector } from '@sammo-ts/infra';
import { InMemoryBattleSimTransport } from '../src/battleSim/inMemoryTransport.js';
import { InMemoryTurnDaemonTransport } from '../src/daemon/inMemoryTransport.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { appRouter } from '../src/router.js';

const profile: GameProfile = {
    id: 'che',
    scenario: 'default',
    name: 'che:default',
};

const buildContext = (options?: {
    state?: WorldStateRow | null;
    transport?: InMemoryTurnDaemonTransport;
    battleSim?: InMemoryBattleSimTransport;
}): GameApiContext => {
    const transport = options?.transport ?? new InMemoryTurnDaemonTransport();
    const battleSim = options?.battleSim ?? new InMemoryBattleSimTransport();
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
        generalTurn: {
            findMany: async () => [],
            deleteMany: async () => ({}),
            createMany: async () => ({}),
        },
        nationTurn: {
            findMany: async () => [],
            deleteMany: async () => ({}),
            createMany: async () => ({}),
        },
    };
    const accessTokenStore = new RedisAccessTokenStore(
        {
            get: async () => null,
            set: async () => null,
        },
        profile.name
    );
    return {
        db: db as unknown as DatabaseClient,
        turnDaemon: transport,
        battleSim,
        profile,
        auth: null,
        redis: {} as unknown as RedisConnector['client'],
        accessTokenStore,
        flushStore: new InMemoryFlushStore(),
        gameTokenSecret: 'test-secret',
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
            id: 1,
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
