import { describe, expect, it } from 'vitest';

import type {
    DatabaseClient,
    GameApiContext,
    GameProfile,
    WorldStateRow,
    GeneralRow,
    GeneralTurnRow,
    NationTurnRow,
} from '../src/context.js';
import type { RedisConnector } from '@sammo-ts/infra';
import { InMemoryBattleSimTransport } from '../src/battleSim/inMemoryTransport.js';
import { InMemoryTurnDaemonTransport } from '../src/daemon/inMemoryTransport.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { appRouter } from '../src/router.js';
import type { GameSessionTokenPayload } from '@sammo-ts/common';

const profile: GameProfile = {
    id: 'che',
    scenario: 'default',
    name: 'che:default',
};

const buildGeneralRow = (overrides?: Partial<GeneralRow>): GeneralRow => {
    const base: GeneralRow = {
        id: 1,
        userId: null,
        name: '테스트',
        nationId: 0,
        cityId: 1,
        troopId: 0,
        npcState: 0,
        affinity: null,
        bornYear: 180,
        deadYear: 300,
        picture: null,
        imageServer: 0,
        leadership: 50,
        strength: 50,
        intel: 50,
        injury: 0,
        experience: 0,
        dedication: 0,
        officerLevel: 0,
        gold: 1000,
        rice: 1000,
        crew: 0,
        crewTypeId: 0,
        train: 0,
        atmos: 0,
        weaponCode: 'None',
        bookCode: 'None',
        horseCode: 'None',
        itemCode: 'None',
        turnTime: new Date('2026-01-01T00:00:00Z'),
        recentWarTime: null,
        age: 20,
        startAge: 20,
        personalCode: 'None',
        specialCode: 'None',
        special2Code: 'None',
        lastTurn: {},
        meta: {},
        penalty: {},
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    return { ...base, ...(overrides ?? {}) };
};

const buildContext = (options?: {
    state?: WorldStateRow | null;
    transport?: InMemoryTurnDaemonTransport;
    battleSim?: InMemoryBattleSimTransport;
    general?: GeneralRow | null;
    generalTurns?: GeneralTurnRow[];
    nationTurns?: NationTurnRow[];
    auth?: GameSessionTokenPayload | null;
}): GameApiContext => {
    const transport = options?.transport ?? new InMemoryTurnDaemonTransport();
    const battleSim = options?.battleSim ?? new InMemoryBattleSimTransport();
    const generalTurns = options?.generalTurns ?? [];
    const nationTurns = options?.nationTurns ?? [];
    const db = {
        worldState: {
            findFirst: async () => options?.state ?? null,
        },
        general: {
            findUnique: async ({ where }: { where: { id: number } }) => {
                if (!options?.general) {
                    return null;
                }
                return options.general.id === where.id ? options.general : null;
            },
        },
        city: {
            findUnique: async () => null,
        },
        nation: {
            findUnique: async () => null,
        },
        generalTurn: {
            findMany: async ({ where }: { where: { generalId: number } }) =>
                generalTurns.filter((row) => row.generalId === where.generalId),
            deleteMany: async () => ({}),
            createMany: async () => ({}),
        },
        nationTurn: {
            findMany: async ({ where }: { where: { nationId: number; officerLevel: number } }) =>
                nationTurns.filter(
                    (row) => row.nationId === where.nationId && row.officerLevel === where.officerLevel
                ),
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
    const auth: GameSessionTokenPayload = options?.auth ?? {
        version: 1,
        profile: profile.name,
        issuedAt: new Date('2026-01-01T00:00:00Z').toISOString(),
        expiresAt: new Date('2026-01-02T00:00:00Z').toISOString(),
        sessionId: 'session-1',
        user: {
            id: 'user-1',
            username: 'tester',
            displayName: 'Tester',
            roles: [],
        },
        sanctions: {},
    };
    return {
        db: db as unknown as DatabaseClient,
        turnDaemon: transport,
        battleSim,
        profile,
        auth,
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

    it('returns reserved general turns', async () => {
        const general = buildGeneralRow({ id: 11 });
        const generalTurns: GeneralTurnRow[] = [
            {
                id: 1,
                generalId: 11,
                turnIdx: 0,
                actionCode: 'che_화계',
                arg: {},
                createdAt: new Date('2026-01-01T00:00:00Z'),
            },
        ];
        const caller = appRouter.createCaller(buildContext({ general, generalTurns }));
        const response = await caller.turns.reserved.getGeneral({ generalId: 11 });

        expect(response[0]?.action).toBe('che_화계');
        expect(response[0]?.index).toBe(0);
    });

    it('returns reserved nation turns', async () => {
        const general = buildGeneralRow({ id: 12, nationId: 3, officerLevel: 5 });
        const nationTurns: NationTurnRow[] = [
            {
                id: 1,
                nationId: 3,
                officerLevel: 5,
                turnIdx: 0,
                actionCode: 'che_포상',
                arg: {},
                createdAt: new Date('2026-01-01T00:00:00Z'),
            },
        ];
        const caller = appRouter.createCaller(buildContext({ general, nationTurns }));
        const response = await caller.turns.reserved.getNation({ generalId: 12 });

        expect(response[0]?.action).toBe('che_포상');
        expect(response[0]?.index).toBe(0);
    });
});
