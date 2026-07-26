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
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';

const profile: GameProfile = {
    id: 'che',
    scenario: 'default',
    name: 'che:default',
};

const buildAuth = (sanctions: GameSessionTokenPayload['sanctions'] = {}): GameSessionTokenPayload => ({
    version: 1,
    profile: profile.name,
    issuedAt: new Date('2026-01-01T00:00:00Z').toISOString(),
    expiresAt: new Date('2026-01-02T00:00:00Z').toISOString(),
    sessionId: 'session-1',
    user: {
        id: 'user-1',
        username: 'tester',
        displayName: 'Tester',
        roles: ['admin'],
    },
    sanctions,
});

const buildGeneralRow = (overrides?: Partial<GeneralRow>): GeneralRow => {
    const base: GeneralRow = {
        id: 1,
        userId: 'user-1',
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
    generalTurnWrites?: unknown[];
    nationTurnWrites?: unknown[];
    auth?: GameSessionTokenPayload | null;
    worldStateReads?: { count: number };
}): GameApiContext => {
    const transport = options?.transport ?? new InMemoryTurnDaemonTransport();
    const battleSim = options?.battleSim ?? new InMemoryBattleSimTransport();
    const generalTurns = options?.generalTurns ?? [];
    const nationTurns = options?.nationTurns ?? [];
    let generalTurnRevision: number | undefined;
    let nationTurnRevision: number | undefined;
    const db = {
        worldState: {
            findFirst: async () => {
                if (options?.worldStateReads) {
                    options.worldStateReads.count += 1;
                }
                return options?.state ?? null;
            },
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
            createMany: async (args: unknown) => {
                options?.generalTurnWrites?.push(args);
                return {};
            },
        },
        generalTurnRevision: {
            findUnique: async () =>
                generalTurnRevision === undefined
                    ? null
                    : { generalId: options?.general?.id ?? 0, revision: generalTurnRevision, updatedAt: new Date() },
            createMany: async ({ data }: { data: Array<{ revision: number }> }) => {
                if (generalTurnRevision !== undefined) {
                    return { count: 0 };
                }
                generalTurnRevision = data[0]?.revision ?? 0;
                return { count: 1 };
            },
            updateMany: async ({ where, data }: { where: { revision: number }; data: { revision: number } }) => {
                if (generalTurnRevision !== where.revision) {
                    return { count: 0 };
                }
                generalTurnRevision = data.revision;
                return { count: 1 };
            },
        },
        nationTurn: {
            findMany: async ({ where }: { where: { nationId: number; officerLevel: number } }) =>
                nationTurns.filter((row) => row.nationId === where.nationId && row.officerLevel === where.officerLevel),
            deleteMany: async () => ({}),
            createMany: async (args: unknown) => {
                options?.nationTurnWrites?.push(args);
                return {};
            },
        },
        nationTurnRevision: {
            findUnique: async () =>
                nationTurnRevision === undefined
                    ? null
                    : {
                          nationId: options?.general?.nationId ?? 0,
                          officerLevel: options?.general?.officerLevel ?? 0,
                          revision: nationTurnRevision,
                          updatedAt: new Date(),
                      },
            createMany: async ({ data }: { data: Array<{ revision: number }> }) => {
                if (nationTurnRevision !== undefined) {
                    return { count: 0 };
                }
                nationTurnRevision = data[0]?.revision ?? 0;
                return { count: 1 };
            },
            updateMany: async ({ where, data }: { where: { revision: number }; data: { revision: number } }) => {
                if (nationTurnRevision !== where.revision) {
                    return { count: 0 };
                }
                nationTurnRevision = data.revision;
                return { count: 1 };
            },
        },
    };
    const accessTokenStore = new RedisAccessTokenStore(
        {
            get: async () => null,
            set: async () => null,
        },
        profile.name
    );
    const defaultAuth = buildAuth();
    const auth = options && 'auth' in options ? (options.auth ?? null) : defaultAuth;
    return {
        db: db as unknown as DatabaseClient,
        turnDaemon: transport,
        battleSim,
        profile,
        auth,
        uploadDir: 'uploads',
        uploadPath: '/uploads',
        uploadPublicUrl: null,
        redis: {} as unknown as RedisConnector['client'],
        accessTokenStore,
        flushStore: new InMemoryFlushStore(),
        gameTokenSecret: 'test-secret',
    };
};

describe('appRouter', () => {
    const blockedGameAccessCases: Array<{
        label: string;
        sanctions: GameSessionTokenPayload['sanctions'];
    }> = [
        {
            label: 'global suspension',
            sanctions: { suspendedUntil: '2099-01-01T00:00:00.000Z' },
        },
        {
            label: 'instance gameplay restriction',
            sanctions: {
                serverRestrictions: {
                    'che:default': { blockedFeatures: ['game'] },
                },
            },
        },
        {
            label: 'base-profile wildcard restriction',
            sanctions: {
                serverRestrictions: {
                    che: { blockedFeatures: ['*'], until: '2099-01-01T00:00:00.000Z' },
                },
            },
        },
    ];

    it.each(blockedGameAccessCases)('blocks authenticated game API access for $label', async ({ sanctions }) => {
        const caller = appRouter.createCaller(
            buildContext({
                auth: buildAuth(sanctions),
                general: buildGeneralRow({ id: 11 }),
            })
        );

        await expect(caller.turns.reserved.getGeneral({ generalId: 11 })).rejects.toMatchObject({
            code: 'FORBIDDEN',
        });
    });

    it('does not apply an expired or message-only restriction to other game APIs', async () => {
        const caller = appRouter.createCaller(
            buildContext({
                auth: buildAuth({
                    mutedUntil: '2099-01-01T00:00:00.000Z',
                    serverRestrictions: {
                        'che:default': {
                            blockedFeatures: ['messages'],
                            until: '2000-01-01T00:00:00.000Z',
                        },
                    },
                }),
                general: buildGeneralRow({ id: 11 }),
            })
        );

        await expect(caller.turns.reserved.getGeneral({ generalId: 11 })).resolves.toBeDefined();
    });

    it('rejects general creation before any game-state read when the signed identity gate denies it', async () => {
        const worldStateReads = { count: 0 };
        const auth: GameSessionTokenPayload = {
            version: 1,
            profile: profile.name,
            issuedAt: new Date('2026-01-01T00:00:00Z').toISOString(),
            expiresAt: new Date('2026-01-02T00:00:00Z').toISOString(),
            sessionId: 'session-local',
            user: {
                id: 'local-user',
                username: 'local-user',
                displayName: '로컬유저',
                roles: ['user'],
            },
            sanctions: {},
            identity: {
                kakaoVerified: false,
                canCreateGeneral: false,
                requiresKakaoVerification: true,
                graceEndsAt: new Date('2026-01-08T00:00:00Z').toISOString(),
            },
        };
        const caller = appRouter.createCaller(buildContext({ auth, worldStateReads }));

        await expect(
            caller.join.createGeneral({
                name: '미인증',
                leadership: 55,
                strength: 55,
                intel: 55,
                character: 'Random',
            })
        ).rejects.toMatchObject({
            code: 'FORBIDDEN',
            message: expect.stringContaining('카카오 인증'),
        });
        expect(worldStateReads.count).toBe(0);
    });

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
            config: { maxUserCnt: 500, hiddenSeed: 'config-secret' },
            meta: { otherTextInfo: 'sample', hiddenSeed: 'meta-secret' },
            updatedAt: new Date('2026-01-01T00:00:00Z'),
        };

        const caller = appRouter.createCaller(buildContext({ state }));
        const response = await caller.world.getState();

        expect(response?.scenarioCode).toBe('default');
        expect(response?.currentYear).toBe(1);
        expect(response?.config).toEqual({ maxUserCnt: 500 });
        expect(response?.meta).toEqual({ otherTextInfo: 'sample' });
        expect(response?.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('requires profile administration permission for turn daemon control', async () => {
        const auth: GameSessionTokenPayload = {
            version: 1,
            profile: profile.name,
            issuedAt: '2026-01-01T00:00:00.000Z',
            expiresAt: '2026-01-02T00:00:00.000Z',
            sessionId: 'session-user',
            user: {
                id: 'user-1',
                username: 'tester',
                displayName: 'Tester',
                roles: ['user'],
            },
            sanctions: {},
        };
        const caller = appRouter.createCaller(buildContext({ auth }));

        await expect(caller.turnDaemon.run({ reason: 'manual' })).rejects.toMatchObject({
            code: 'FORBIDDEN',
        });
        await expect(caller.turnDaemon.pause()).rejects.toMatchObject({
            code: 'FORBIDDEN',
        });
        await expect(caller.turnDaemon.resume()).rejects.toMatchObject({
            code: 'FORBIDDEN',
        });
        await expect(caller.turnDaemon.status()).rejects.toMatchObject({
            code: 'FORBIDDEN',
        });
    });

    it('rejects unauthenticated turn daemon control', async () => {
        const caller = appRouter.createCaller(buildContext({ auth: null }));

        await expect(caller.turnDaemon.pause()).rejects.toMatchObject({
            code: 'UNAUTHORIZED',
        });
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

        expect(response.revision).toBe(0);
        expect(response.turns[0]?.action).toBe('che_화계');
        expect(response.turns[0]?.index).toBe(0);
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

        expect(response.revision).toBe(0);
        expect(response.turns[0]?.action).toBe('che_포상');
        expect(response.turns[0]?.index).toBe(0);
    });

    it('validates and persists general command arguments from the authenticated owner', async () => {
        const general = buildGeneralRow({ id: 13 });
        const writes: unknown[] = [];
        const caller = appRouter.createCaller(buildContext({ general, generalTurnWrites: writes }));

        const response = await caller.turns.reserved.setGeneral({
            generalId: 13,
            turnIndex: 0,
            action: 'che_화계',
            args: { destCityId: 7 },
            expectedRevision: 0,
        });

        expect(response.turns[0]).toMatchObject({ action: 'che_화계', args: { destCityId: 7 } });
        expect(writes).toHaveLength(1);
        const written = writes[0] as { data: unknown[] };
        expect(written.data).toHaveLength(30);
        expect(written.data[0]).toMatchObject({
            generalId: 13,
            turnIdx: 0,
            actionCode: 'che_화계',
            arg: { destCityId: 7 },
        });

        await expect(
            caller.turns.reserved.setGeneral({
                generalId: 13,
                turnIndex: 1,
                action: '휴식',
                expectedRevision: 0,
            })
        ).rejects.toMatchObject({ code: 'CONFLICT' });
        expect(writes).toHaveLength(1);
    });

    it('rejects malformed and cross-scope arguments without writing turns', async () => {
        const general = buildGeneralRow({ id: 14, nationId: 3, officerLevel: 5 });
        const generalWrites: unknown[] = [];
        const nationWrites: unknown[] = [];
        const caller = appRouter.createCaller(
            buildContext({ general, generalTurnWrites: generalWrites, nationTurnWrites: nationWrites })
        );

        await expect(
            caller.turns.reserved.setGeneral({
                generalId: 14,
                turnIndex: 0,
                action: 'che_화계',
                args: { destCityId: '7' },
                expectedRevision: 0,
            })
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        await expect(
            caller.turns.reserved.setGeneral({
                generalId: 14,
                turnIndex: 0,
                action: 'che_포상',
                args: { isGold: true, amount: 1, destGeneralId: 7 },
                expectedRevision: 0,
            })
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

        expect(generalWrites).toHaveLength(0);
        expect(nationWrites).toHaveLength(0);
    });

    it('rejects another user general across actor-owned routers', async () => {
        const general = buildGeneralRow({ id: 15, userId: 'user-2' });
        const caller = appRouter.createCaller(buildContext({ general }));

        await expect(caller.turns.getCommandTable({ generalId: general.id })).rejects.toMatchObject({
            code: 'FORBIDDEN',
        });
        await expect(caller.turns.reserved.getGeneral({ generalId: general.id })).rejects.toMatchObject({
            code: 'FORBIDDEN',
        });
        await expect(caller.turns.reserved.getNation({ generalId: general.id })).rejects.toMatchObject({
            code: 'FORBIDDEN',
        });
        await expect(
            caller.turns.reserved.setGeneral({
                generalId: general.id,
                turnIndex: 0,
                action: '휴식',
                expectedRevision: 0,
            })
        ).rejects.toMatchObject({
            code: 'FORBIDDEN',
        });
        await expect(
            caller.turns.reserved.shiftGeneral({
                generalId: general.id,
                amount: 1,
                expectedRevision: 0,
            })
        ).rejects.toMatchObject({
            code: 'FORBIDDEN',
        });
        await expect(
            caller.turns.reserved.setNation({
                generalId: general.id,
                turnIndex: 0,
                action: '휴식',
                expectedRevision: 0,
            })
        ).rejects.toMatchObject({
            code: 'FORBIDDEN',
        });
        await expect(
            caller.turns.reserved.shiftNation({
                generalId: general.id,
                amount: 1,
                expectedRevision: 0,
            })
        ).rejects.toMatchObject({
            code: 'FORBIDDEN',
        });
        await expect(caller.messages.getRecent({ generalId: general.id })).rejects.toMatchObject({
            code: 'FORBIDDEN',
        });
        await expect(
            caller.messages.getOld({
                generalId: general.id,
                to: 1,
                type: 'private',
            })
        ).rejects.toMatchObject({
            code: 'FORBIDDEN',
        });
        await expect(
            caller.messages.send({
                generalId: general.id,
                mailbox: 0,
                text: 'test',
            })
        ).rejects.toMatchObject({
            code: 'FORBIDDEN',
        });
        await expect(
            caller.world.getMap({
                generalId: general.id,
                showMe: true,
            })
        ).rejects.toMatchObject({
            code: 'FORBIDDEN',
        });
    });

    it('rejects unauthenticated general-scoped map views', async () => {
        const general = buildGeneralRow({ id: 16 });
        const caller = appRouter.createCaller(buildContext({ general, auth: null }));

        await expect(caller.world.getMap({ generalId: general.id })).rejects.toMatchObject({
            code: 'UNAUTHORIZED',
        });
    });
});
