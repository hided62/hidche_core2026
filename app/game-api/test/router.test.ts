import { describe, expect, it, vi } from 'vitest';

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
import { encryptGameSessionToken, type GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';

const profile: GameProfile = {
    id: 'che',
    scenario: 'default',
    name: 'che:default',
};

const buildWorldState = (joinMode = 'full'): WorldStateRow =>
    ({
        id: 1,
        scenarioCode: 'default',
        currentYear: 190,
        currentMonth: 1,
        tickSeconds: 600,
        config: {
            joinMode,
            const: {},
        },
        meta: {
            scenarioMeta: {
                startYear: 180,
            },
        },
        updatedAt: new Date('2026-01-01T00:00:00Z'),
    }) as unknown as WorldStateRow;

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
    currentAccountIcon?: unknown;
    accountIconGet?: (userId: string) => Promise<unknown>;
    accessTokenStore?: RedisAccessTokenStore;
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
        redis: {
            get: async () => null,
        } as unknown as RedisConnector['client'],
        accessTokenStore: options?.accessTokenStore ?? accessTokenStore,
        flushStore: new InMemoryFlushStore(),
        gameTokenSecret: 'test-secret',
        accountIconSource: {
            get: async (userId: string) => {
                if (options?.accountIconGet) {
                    return (await options.accountIconGet(userId)) as {
                        revision: string;
                        picture: string;
                        imageServer: number;
                    } | null;
                }
                return options?.currentAccountIcon === undefined
                    ? null
                    : (options.currentAccountIcon as {
                          revision: string;
                          picture: string;
                          imageServer: number;
                      });
            },
        },
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

    it('reports the authenticated game access-token identity', async () => {
        const caller = appRouter.createCaller(buildContext({ auth: buildAuth() }));

        await expect(caller.auth.status()).resolves.toEqual({ userId: 'user-1' });
    });

    it('keeps ordinary account icon changes on the explicitly selected servers', async () => {
        const transport = new InMemoryTurnDaemonTransport();
        const accountIconGet = vi.fn(async () => {
            throw new Error('ordinary exchange must not read the icon source');
        });
        const accessTokenStore = {
            issueFromGateway: vi.fn(async () => ({
                accessToken: 'ga_access',
                expiresAt: '2099-01-01T01:00:00.000Z',
            })),
        } as unknown as RedisAccessTokenStore;
        const payload = buildAuth();
        payload.issuedAt = '2099-01-01T00:00:00.000Z';
        payload.expiresAt = '2099-01-01T01:00:00.000Z';
        payload.user.iconUpdatedAt = '2099-01-01T00:00:00.000Z';
        const caller = appRouter.createCaller(
            buildContext({
                auth: null,
                transport,
                accountIconGet,
                accessTokenStore,
            })
        );

        await expect(
            caller.auth.exchangeGatewayToken({
                gatewayToken: encryptGameSessionToken(payload, 'test-secret'),
            })
        ).resolves.toMatchObject({ accessToken: 'ga_access' });
        expect(accountIconGet).not.toHaveBeenCalled();
        expect(transport.commands).toHaveLength(0);
    });

    it('durably re-applies an administrator reset before consuming the one-time token', async () => {
        const transport = new InMemoryTurnDaemonTransport();
        const calls: string[] = [];
        const revision = '2099-01-01T00:00:00.001Z';
        const accessTokenStore = {
            issueFromGateway: vi.fn(async () => {
                calls.push('mark-used');
                return {
                    accessToken: 'ga_access',
                    expiresAt: '2099-01-01T01:00:00.000Z',
                };
            }),
        } as unknown as RedisAccessTokenStore;
        const payload = buildAuth();
        payload.issuedAt = '2099-01-01T00:00:00.000Z';
        payload.expiresAt = '2099-01-01T01:00:00.000Z';
        payload.user.iconUpdatedAt = revision;
        payload.user.profileIconResetAt = revision;
        const caller = appRouter.createCaller(
            buildContext({
                auth: null,
                transport,
                accessTokenStore,
                accountIconGet: async () => {
                    calls.push('projection');
                    return {
                        revision,
                        picture: 'default.jpg',
                        imageServer: 0,
                    };
                },
            })
        );

        await caller.auth.exchangeGatewayToken({
            gatewayToken: encryptGameSessionToken(payload, 'test-secret'),
        });

        expect(calls).toEqual(['projection', 'mark-used']);
        expect(transport.commands.at(-1)?.command).toEqual({
            type: 'adjustGeneralIcon',
            requestId: `general:adjustIcon:${payload.user.id}:${revision}`,
            userId: payload.user.id,
            picture: 'default.jpg',
            imageServer: 0,
            iconRevision: revision,
        });
    });

    it('applies the current Gateway database icon instead of stale token claims', async () => {
        const transport = new InMemoryTurnDaemonTransport();
        const currentAccountIcon = {
            revision: '2026-07-31T09:00:00.000Z',
            picture: 'latest.png',
            imageServer: 1,
        };
        const auth = buildAuth();
        auth.user.picture = 'stale.png';
        auth.user.imageServer = 0;
        auth.user.iconUpdatedAt = '2026-07-30T09:00:00.000Z';
        const requestId = `general:adjustIcon:${auth.user.id}:${currentAccountIcon.revision}`;
        transport.setCommandResult(requestId, {
            type: 'adjustGeneralIcon',
            ok: true,
            generalId: 1,
            updated: true,
        });
        const caller = appRouter.createCaller(
            buildContext({
                auth,
                transport,
                currentAccountIcon,
            })
        );

        await expect(caller.general.adjustIcon()).resolves.toEqual({
            ok: true,
            generalId: 1,
            updated: true,
        });
        expect(transport.commands.at(-1)?.command).toEqual({
            type: 'adjustGeneralIcon',
            requestId,
            userId: auth.user.id,
            picture: 'latest.png',
            imageServer: 1,
            iconRevision: currentAccountIcon.revision,
            enforceCooldown: true,
        });
    });

    it('uses a fresh client request id when selecting a registered in-game icon', async () => {
        const transport = new InMemoryTurnDaemonTransport();
        const clientRequestId = 'b24454da-d0ab-48d2-a7d5-e2e5aaf83ba4';
        const requestId = `general:adjustIcon:user-1:manual:${clientRequestId}`;
        transport.setCommandResult(requestId, {
            type: 'adjustGeneralIcon',
            ok: true,
            generalId: 1,
            updated: true,
        });
        const auth = buildAuth();
        auth.user.icons = [
            {
                id: '3f804277-584f-4f44-b39c-9ecf40d1ed31',
                picture: 'manual.png',
                imageServer: 1,
                createdAt: '2026-07-30T09:00:00.000Z',
            },
        ];
        const caller = appRouter.createCaller(buildContext({ auth, transport }));

        await caller.general.adjustIcon({ iconId: auth.user.icons[0]!.id, clientRequestId });

        expect(transport.commands.at(-1)?.command).toMatchObject({
            requestId,
            picture: 'manual.png',
            imageServer: 1,
            enforceCooldown: true,
        });
    });

    it('rejects icon adjustment without auth or a current Gateway account', async () => {
        await expect(appRouter.createCaller(buildContext({ auth: null })).general.adjustIcon()).rejects.toMatchObject({
            code: 'UNAUTHORIZED',
        });
        await expect(
            appRouter.createCaller(buildContext({ auth: buildAuth() })).general.adjustIcon()
        ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    });

    it('rejects unauthenticated or game-blocked auth status checks', async () => {
        await expect(appRouter.createCaller(buildContext({ auth: null })).auth.status()).rejects.toMatchObject({
            code: 'UNAUTHORIZED',
        });
        await expect(
            appRouter
                .createCaller(
                    buildContext({
                        auth: buildAuth({
                            suspendedUntil: '2099-01-01T00:00:00.000Z',
                        }),
                    })
                )
                .auth.status()
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
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
                pic: false,
                character: 'Random',
            })
        ).rejects.toMatchObject({
            code: 'FORBIDDEN',
            message: expect.stringContaining('카카오 인증'),
        });
        expect(worldStateReads.count).toBe(0);
    });

    it('does not require the Gateway icon source when creating a default-picture general', async () => {
        const transport = new InMemoryTurnDaemonTransport();
        const clientRequestId = '1b9afacd-d29b-456d-8ef3-a6be4b497e6e';
        const requestId = `join-create:user-1:${clientRequestId}`;
        transport.setCommandResult(requestId, {
            type: 'joinCreateGeneral',
            ok: true,
            generalId: 41,
        });
        const accountIconGet = vi.fn(async () => {
            throw new Error('default-picture join must not read the icon source');
        });
        const caller = appRouter.createCaller(
            buildContext({
                state: buildWorldState(),
                transport,
                accountIconGet,
            })
        );

        await expect(
            caller.join.createGeneral({
                name: '기본전콘',
                leadership: 55,
                strength: 55,
                intel: 55,
                pic: false,
                character: 'Random',
                clientRequestId,
            })
        ).resolves.toEqual({ ok: true, generalId: 41 });
        expect(accountIconGet).not.toHaveBeenCalled();
        expect(transport.commands.at(-1)?.command).not.toHaveProperty('ownerIconRevision');
    });

    it('uses the authoritative projection instead of stale token claims for picture creation', async () => {
        const transport = new InMemoryTurnDaemonTransport();
        const clientRequestId = '824454da-d0ab-48d2-a7d5-e2e5aaf83ba4';
        const requestId = `join-create:user-1:${clientRequestId}`;
        const revision = '2026-07-31T09:00:00.001Z';
        transport.setCommandResult(requestId, {
            type: 'joinCreateGeneral',
            ok: true,
            generalId: 42,
        });
        const auth = buildAuth();
        auth.user.picture = 'stale.png';
        auth.user.imageServer = 0;
        auth.user.iconUpdatedAt = '2026-07-30T09:00:00.000Z';
        const caller = appRouter.createCaller(
            buildContext({
                state: buildWorldState(),
                auth,
                transport,
                currentAccountIcon: {
                    revision,
                    picture: 'latest.png',
                    imageServer: 1,
                },
            })
        );

        await caller.join.createGeneral({
            name: '최신전콘',
            leadership: 55,
            strength: 55,
            intel: 55,
            pic: true,
            character: 'Random',
            clientRequestId,
        });

        expect(transport.commands.at(-1)?.command).toMatchObject({
            ownerPicture: 'latest.png',
            ownerImageServer: 1,
            ownerIconRevision: revision,
        });
    });

    it('creates a general with the selected authenticated icon and rejects another icon id', async () => {
        const transport = new InMemoryTurnDaemonTransport();
        const clientRequestId = '924454da-d0ab-48d2-a7d5-e2e5aaf83ba4';
        transport.setCommandResult(`join-create:user-1:${clientRequestId}`, {
            type: 'joinCreateGeneral',
            ok: true,
            generalId: 43,
        });
        const auth = buildAuth();
        auth.user.iconUpdatedAt = '2026-08-01T09:00:00.000Z';
        auth.user.icons = [
            {
                id: '3f804277-584f-4f44-b39c-9ecf40d1ed31',
                picture: 'selected.png',
                imageServer: 1,
                createdAt: '2026-07-30T09:00:00.000Z',
            },
        ];
        const caller = appRouter.createCaller(buildContext({ state: buildWorldState(), auth, transport }));

        await caller.join.createGeneral({
            name: '선택전콘',
            leadership: 55,
            strength: 55,
            intel: 55,
            pic: true,
            iconId: auth.user.icons[0]!.id,
            character: 'Random',
            clientRequestId,
        });
        expect(transport.commands.at(-1)?.command).toMatchObject({
            ownerPicture: 'selected.png',
            ownerImageServer: 1,
            ownerIconRevision: auth.user.iconUpdatedAt,
        });

        const poolRequestId = 'a24454da-d0ab-48d2-a7d5-e2e5aaf83ba4';
        transport.setCommandResult(`select-pool:user-1:${poolRequestId}:create`, {
            type: 'selectPoolCreate',
            ok: true,
            generalId: 44,
        });
        await caller.join.selectPoolGeneral({
            uniqueName: '선택풀장수',
            personality: 'Random',
            iconId: auth.user.icons[0]!.id,
            clientRequestId: poolRequestId,
        });
        expect(transport.commands.at(-1)?.command).toMatchObject({
            type: 'selectPoolCreate',
            ownerPicture: 'selected.png',
            ownerImageServer: 1,
            ownerIconRevision: auth.user.iconUpdatedAt,
        });

        await expect(
            caller.join.createGeneral({
                name: '타인전콘',
                leadership: 55,
                strength: 55,
                intel: 55,
                pic: true,
                iconId: 'f6af46a2-809a-481d-b66d-0f7bbb706780',
                character: 'Random',
            })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
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
            config: {
                maxUserCnt: 500,
                hiddenSeed: 'config-secret',
                environment: {
                    scenarioEffect: 'event_StrongAttacker',
                    hiddenSeed: 'environment-secret',
                },
            },
            meta: { otherTextInfo: 'sample', hiddenSeed: 'meta-secret' },
            updatedAt: new Date('2026-01-01T00:00:00Z'),
        };

        const caller = appRouter.createCaller(buildContext({ state }));
        const response = await caller.world.getState();

        expect(response?.scenarioCode).toBe('default');
        expect(response?.currentYear).toBe(1);
        expect(response?.config).toEqual({
            maxUserCnt: 500,
            environment: { scenarioEffect: 'event_StrongAttacker' },
        });
        expect(response?.meta).toEqual({ otherTextInfo: 'sample' });
        expect(response?.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it.each(['', 'None', null])('normalizes the persisted no-effect sentinel %j in world snapshots', async (value) => {
        const state: WorldStateRow = {
            id: 1,
            scenarioCode: 'default',
            currentYear: 1,
            currentMonth: 2,
            tickSeconds: 600,
            config: { environment: { scenarioEffect: value } },
            meta: {},
            updatedAt: new Date('2026-01-01T00:00:00Z'),
        };

        const caller = appRouter.createCaller(buildContext({ state }));

        await expect(caller.world.getState()).resolves.toMatchObject({
            config: { environment: { scenarioEffect: null } },
        });
    });

    it('rejects unknown persisted scenario effects in world snapshots', async () => {
        const state: WorldStateRow = {
            id: 1,
            scenarioCode: 'default',
            currentYear: 1,
            currentMonth: 2,
            tickSeconds: 600,
            config: { environment: { scenarioEffect: 'event_Missing' } },
            meta: {},
            updatedAt: new Date('2026-01-01T00:00:00Z'),
        };

        const caller = appRouter.createCaller(buildContext({ state }));

        await expect(caller.world.getState()).rejects.toThrow();
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
        const general = buildGeneralRow({ id: 11, meta: { autorun_limit: 2408 } });
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
        expect(response.autorunLimit).toBe(2408);
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
        const caller = appRouter.createCaller(
            buildContext({ state: buildWorldState(), general, generalTurnWrites: writes })
        );

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

    it('applies legacy general sentinel bulk entries and repeats the leading pattern', async () => {
        const general = buildGeneralRow({ id: 16 });
        const bulkWrites: unknown[] = [];
        const bulkCaller = appRouter.createCaller(
            buildContext({ state: buildWorldState(), general, generalTurnWrites: bulkWrites })
        );

        const bulk = await bulkCaller.turns.reserved.setGeneralBulk({
            generalId: general.id,
            entries: [
                { turnList: [-1], action: 'che_훈련' },
                { turnList: [-2], action: 'che_사기진작' },
            ],
            expectedRevision: 0,
        });
        expect(bulk.turns[0]?.action).toBe('che_훈련');
        expect(bulk.turns[1]?.action).toBe('che_사기진작');
        expect(bulk.turns[29]?.action).toBe('che_사기진작');
        expect(bulkWrites).toHaveLength(1);

        const repeatWrites: unknown[] = [];
        const repeatCaller = appRouter.createCaller(
            buildContext({
                general,
                generalTurns: [
                    {
                        id: 1,
                        generalId: general.id,
                        turnIdx: 0,
                        actionCode: 'che_훈련',
                        arg: {},
                        createdAt: new Date(),
                    },
                    {
                        id: 2,
                        generalId: general.id,
                        turnIdx: 1,
                        actionCode: 'che_사기진작',
                        arg: {},
                        createdAt: new Date(),
                    },
                ],
                generalTurnWrites: repeatWrites,
            })
        );
        const repeated = await repeatCaller.turns.reserved.repeatGeneral({
            generalId: general.id,
            amount: 2,
            expectedRevision: 0,
        });
        expect(repeated.turns.slice(0, 6).map((turn) => turn.action)).toEqual([
            'che_훈련',
            'che_사기진작',
            'che_훈련',
            'che_사기진작',
            'che_훈련',
            'che_사기진작',
        ]);
        expect(repeatWrites).toHaveLength(1);
    });

    it('accepts the legacy nation amount-12 no-op without incrementing revision', async () => {
        const general = buildGeneralRow({ id: 17, nationId: 3, officerLevel: 12 });
        const nationWrites: unknown[] = [];
        const caller = appRouter.createCaller(
            buildContext({ state: buildWorldState(), general, nationTurnWrites: nationWrites })
        );

        const shifted = await caller.turns.reserved.shiftNation({
            generalId: general.id,
            amount: 12,
            expectedRevision: 0,
        });
        const repeated = await caller.turns.reserved.repeatNation({
            generalId: general.id,
            amount: 12,
            expectedRevision: 0,
        });

        expect(shifted.revision).toBe(0);
        expect(repeated.revision).toBe(0);
        expect(nationWrites).toHaveLength(0);
    });

    it('applies nation bulk entries sequentially so later entries overwrite overlaps', async () => {
        const general = buildGeneralRow({ id: 18, nationId: 3, officerLevel: 12 });
        const nationWrites: unknown[] = [];
        const caller = appRouter.createCaller(
            buildContext({ state: buildWorldState(), general, nationTurnWrites: nationWrites })
        );

        const response = await caller.turns.reserved.setNationBulk({
            generalId: general.id,
            entries: [
                {
                    turnList: [0, 2],
                    action: 'che_포상',
                    args: { isGold: true, amount: 1, destGeneralId: 7 },
                },
                {
                    turnList: [2],
                    action: 'che_포상',
                    args: { isGold: false, amount: 2, destGeneralId: 8 },
                },
            ],
            expectedRevision: 0,
        });

        expect(response.turns[0]?.args).toEqual({ isGold: true, amount: 1, destGeneralId: 7 });
        expect(response.turns[2]?.args).toEqual({ isGold: false, amount: 2, destGeneralId: 8 });
        expect(nationWrites).toHaveLength(1);
    });

    it('enforces only legacy reservation permissions without applying full execution constraints', async () => {
        const general = buildGeneralRow({ id: 19 });
        const allowedWrites: unknown[] = [];
        const allowedCaller = appRouter.createCaller(
            buildContext({
                state: buildWorldState('full'),
                general,
                generalTurnWrites: allowedWrites,
            })
        );
        await expect(
            allowedCaller.turns.reserved.setGeneral({
                generalId: general.id,
                turnIndex: 0,
                action: 'che_임관',
                args: { destNationId: 2 },
                expectedRevision: 0,
            })
        ).resolves.toMatchObject({ ok: true });
        expect(allowedWrites).toHaveLength(1);

        const randomOnlyWrites: unknown[] = [];
        const randomOnlyCaller = appRouter.createCaller(
            buildContext({
                state: buildWorldState('onlyRandom'),
                general,
                generalTurnWrites: randomOnlyWrites,
            })
        );
        await expect(
            randomOnlyCaller.turns.reserved.setGeneral({
                generalId: general.id,
                turnIndex: 0,
                action: 'che_임관',
                args: { destNationId: 2 },
                expectedRevision: 0,
            })
        ).rejects.toMatchObject({
            code: 'PRECONDITION_FAILED',
            message: expect.stringContaining('랜덤 임관만 가능합니다'),
        });
        expect(randomOnlyWrites).toHaveLength(0);
    });

    it('checks nation treaty-term reservation permission but not full diplomacy state', async () => {
        const general = buildGeneralRow({ id: 20, nationId: 3, officerLevel: 12 });
        const shortTermWrites: unknown[] = [];
        const shortTermCaller = appRouter.createCaller(
            buildContext({
                state: buildWorldState(),
                general,
                nationTurnWrites: shortTermWrites,
            })
        );
        await expect(
            shortTermCaller.turns.reserved.setNation({
                generalId: general.id,
                turnIndex: 0,
                action: 'che_불가침제의',
                args: { destNationId: 2, year: 190, month: 6 },
                expectedRevision: 0,
            })
        ).rejects.toMatchObject({
            code: 'PRECONDITION_FAILED',
            message: expect.stringContaining('기한은 6개월 이상'),
        });
        expect(shortTermWrites).toHaveLength(0);

        const validTermWrites: unknown[] = [];
        const validTermCaller = appRouter.createCaller(
            buildContext({
                state: buildWorldState(),
                general,
                nationTurnWrites: validTermWrites,
            })
        );
        await expect(
            validTermCaller.turns.reserved.setNation({
                generalId: general.id,
                turnIndex: 0,
                action: 'che_불가침제의',
                args: { destNationId: 2, year: 190, month: 7 },
                expectedRevision: 0,
            })
        ).resolves.toMatchObject({ ok: true });
        expect(validTermWrites).toHaveLength(1);
    });

    it('validates every bulk reservation permission before writing any turn', async () => {
        const general = buildGeneralRow({ id: 21 });
        const writes: unknown[] = [];
        const caller = appRouter.createCaller(
            buildContext({
                state: buildWorldState('onlyRandom'),
                general,
                generalTurnWrites: writes,
            })
        );

        await expect(
            caller.turns.reserved.setGeneralBulk({
                generalId: general.id,
                entries: [
                    { turnList: [0], action: 'che_훈련' },
                    {
                        turnList: [1],
                        action: 'che_임관',
                        args: { destNationId: 2 },
                    },
                ],
                expectedRevision: 0,
            })
        ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
        expect(writes).toHaveLength(0);
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
