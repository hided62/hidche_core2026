import { describe, expect, it } from 'vitest';

import type { BattleSimJobPayload, BattleSimResultPayload } from '../src/battleSim/types.js';
import type { BattleSimTransport } from '../src/battleSim/transport.js';
import type { DatabaseClient, GameApiContext, GameProfile, WorldStateRow } from '../src/context.js';
import type { RedisConnector } from '@sammo-ts/infra';
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

class QueuedBattleSimTransport implements BattleSimTransport {
    public simulateCalls = 0;
    public lastPayload: BattleSimJobPayload | null = null;
    public lastRequesterUserId: string | null = null;
    private readonly owners = new Map<string, string>();
    private readonly results = new Map<string, BattleSimResultPayload>();

    async simulate(payload: BattleSimJobPayload, requesterUserId: string) {
        this.simulateCalls += 1;
        this.lastPayload = payload;
        this.lastRequesterUserId = requesterUserId;
        const jobId = `job-${this.simulateCalls}`;
        this.owners.set(jobId, requesterUserId);
        return { status: 'queued', jobId } as const;
    }

    async getSimulationResult(jobId: string, requesterUserId: string) {
        if (this.owners.get(jobId) !== requesterUserId) {
            return null;
        }
        return this.results.get(jobId) ?? null;
    }

    pushResult(jobId: string, requesterUserId: string, payload: BattleSimResultPayload) {
        if (this.owners.get(jobId) !== requesterUserId) {
            throw new Error('requester mismatch');
        }
        this.results.set(jobId, payload);
    }
}

const buildBattleRequest = () => ({
    action: 'battle' as const,
    repeatCnt: 1,
    year: 200,
    month: 1,
    seed: 'test-seed',
    attackerGeneral: {
        no: 1,
        name: 'Attacker',
        nation: 1,
        turntime: '2026-01-01 00:00:00',
        personal: null,
        special2: null,
        crew: 1000,
        crewtype: 100,
        atmos: 100,
        train: 100,
        intel: 70,
        intel_exp: 0,
        book: null,
        strength: 70,
        strength_exp: 0,
        weapon: null,
        injury: 0,
        leadership: 70,
        leadership_exp: 0,
        horse: null,
        item: null,
        explevel: 0,
        experience: 100,
        dedication: 100,
        officer_level: 3,
        officer_city: 1,
        gold: 1000,
        rice: 1000,
        dex1: 0,
        dex2: 0,
        dex3: 0,
        dex4: 0,
        dex5: 0,
        defence_train: 0,
        recent_war: null,
        warnum: 0,
        killnum: 0,
        killcrew: 0,
    },
    attackerCity: {
        city: 1,
        nation: 1,
        supply: 1,
        name: 'AttackerCity',
        pop: 10000,
        agri: 1000,
        comm: 1000,
        secu: 1000,
        def: 100,
        wall: 100,
        trust: 100,
        level: 2,
        pop_max: 10000,
        agri_max: 1000,
        comm_max: 1000,
        secu_max: 1000,
        def_max: 200,
        wall_max: 200,
        dead: 0,
        state: 0,
        conflict: '{}',
    },
    attackerNation: {
        type: 'test',
        tech: 1000,
        level: 1,
        capital: 1,
        nation: 1,
        name: 'AttackerNation',
        gold: 1000,
        rice: 1000,
        gennum: 1,
    },
    defenderGenerals: [
        {
            no: 2,
            name: 'Defender',
            nation: 2,
            turntime: '2026-01-01 00:00:00',
            personal: null,
            special2: null,
            crew: 1000,
            crewtype: 100,
            atmos: 100,
            train: 100,
            intel: 60,
            intel_exp: 0,
            book: null,
            strength: 60,
            strength_exp: 0,
            weapon: null,
            injury: 0,
            leadership: 60,
            leadership_exp: 0,
            horse: null,
            item: null,
            explevel: 0,
            experience: 100,
            dedication: 100,
            officer_level: 3,
            officer_city: 2,
            gold: 1000,
            rice: 1000,
            dex1: 0,
            dex2: 0,
            dex3: 0,
            dex4: 0,
            dex5: 0,
            defence_train: 0,
            recent_war: null,
            warnum: 0,
            killnum: 0,
            killcrew: 0,
        },
    ],
    defenderCity: {
        city: 2,
        nation: 2,
        supply: 1,
        name: 'DefenderCity',
        pop: 10000,
        agri: 1000,
        comm: 1000,
        secu: 1000,
        def: 100,
        wall: 100,
        trust: 100,
        level: 2,
        pop_max: 10000,
        agri_max: 1000,
        comm_max: 1000,
        secu_max: 1000,
        def_max: 200,
        wall_max: 200,
        dead: 0,
        state: 0,
        conflict: '{}',
    },
    defenderNation: {
        type: 'test',
        tech: 1000,
        level: 1,
        capital: 2,
        nation: 2,
        name: 'DefenderNation',
        gold: 1000,
        rice: 1000,
        gennum: 1,
    },
});

const buildContext = (options: {
    state: WorldStateRow;
    battleSim: BattleSimTransport;
    userId?: string | null;
    db?: Partial<DatabaseClient>;
}): GameApiContext => {
    const db = options.db ?? {
        worldState: {
            findFirst: async () => options.state,
        },
    };
    const accessTokenStore = new RedisAccessTokenStore(
        {
            get: async () => null,
            set: async () => null,
        },
        profile.name
    );
    const auth: GameSessionTokenPayload | null =
        options.userId === null
            ? null
            : {
                  version: 1,
                  profile: profile.name,
                  issuedAt: new Date('2026-01-01T00:00:00Z').toISOString(),
                  expiresAt: new Date('2026-01-02T00:00:00Z').toISOString(),
                  sessionId: 'session-1',
                  user: {
                      id: options.userId ?? 'user-1',
                      username: 'tester',
                      displayName: 'Tester',
                      roles: [],
                  },
                  sanctions: {},
              };
    return {
        db: db as unknown as DatabaseClient,
        turnDaemon: new InMemoryTurnDaemonTransport(),
        battleSim: options.battleSim,
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

describe('battle router orchestration', () => {
    it('returns queued then completed results via transport', async () => {
        const battleSim = new QueuedBattleSimTransport();
        const state: WorldStateRow = {
            id: 1,
            scenarioCode: 'default',
            currentYear: 200,
            currentMonth: 1,
            tickSeconds: 600,
            config: { environment: { scenarioEffect: 'event_MoreEffect' } },
            meta: {},
            updatedAt: new Date('2026-01-01T00:00:00Z'),
        };
        const caller = appRouter.createCaller(buildContext({ state, battleSim }));

        const response = await caller.battle.simulate(buildBattleRequest());
        expect(response.status).toBe('queued');
        expect(battleSim.simulateCalls).toBe(1);
        expect(battleSim.lastRequesterUserId).toBe('user-1');
        expect(battleSim.lastPayload?.scenarioEffect).toBe('event_MoreEffect');

        const queued = await caller.battle.getSimulation({ jobId: response.jobId });
        expect(queued.status).toBe('queued');

        battleSim.pushResult(response.jobId, 'user-1', { result: true, reason: 'success', avgWar: 1 });

        const completed = await caller.battle.getSimulation({ jobId: response.jobId });
        expect(completed.status).toBe('completed');
        expect(completed.payload?.result).toBe(true);
    });

    it('uses the stored scenario effect even when a client sends a same-named field', async () => {
        const battleSim = new QueuedBattleSimTransport();
        const state: WorldStateRow = {
            id: 1,
            scenarioCode: 'default',
            currentYear: 200,
            currentMonth: 1,
            tickSeconds: 600,
            config: { environment: { scenarioEffect: 'event_MoreEffect' } },
            meta: {},
            updatedAt: new Date('2026-01-01T00:00:00Z'),
        };
        const caller = appRouter.createCaller(buildContext({ state, battleSim }));
        const maliciousRequest = {
            ...buildBattleRequest(),
            scenarioEffect: 'event_StrongAttacker',
        } as ReturnType<typeof buildBattleRequest>;

        await expect(caller.battle.simulate(maliciousRequest)).resolves.toMatchObject({ status: 'queued' });
        expect(battleSim.lastPayload?.scenarioEffect).toBe('event_MoreEffect');
    });

    it('rejects an unknown stored scenario effect before queuing the simulation', async () => {
        const battleSim = new QueuedBattleSimTransport();
        const state: WorldStateRow = {
            id: 1,
            scenarioCode: 'default',
            currentYear: 200,
            currentMonth: 1,
            tickSeconds: 600,
            config: { environment: { scenarioEffect: 'event_Missing' } },
            meta: {},
            updatedAt: new Date('2026-01-01T00:00:00Z'),
        };
        const caller = appRouter.createCaller(buildContext({ state, battleSim }));

        await expect(caller.battle.simulate(buildBattleRequest())).rejects.toThrow(
            'Unknown scenario effect: event_Missing'
        );
        expect(battleSim.simulateCalls).toBe(0);
    });

    it('requires login, allows a user without a general, and does not open an input-event transaction', async () => {
        const battleSim = new QueuedBattleSimTransport();
        const state: WorldStateRow = {
            id: 1,
            scenarioCode: 'default',
            currentYear: 200,
            currentMonth: 1,
            tickSeconds: 600,
            config: {},
            meta: {},
            updatedAt: new Date('2026-01-01T00:00:00Z'),
        };
        let transactionCalls = 0;
        const db = {
            worldState: { findFirst: async () => state },
            $transaction: async () => {
                transactionCalls += 1;
                throw new Error('simulation must not create an input event transaction');
            },
        } as unknown as DatabaseClient;

        const anonymous = appRouter.createCaller(buildContext({ state, battleSim, userId: null, db }));
        await expect(anonymous.battle.simulate(buildBattleRequest())).rejects.toMatchObject({
            code: 'UNAUTHORIZED',
        });

        const noGeneralUser = appRouter.createCaller(
            buildContext({ state, battleSim, userId: 'user-without-general', db })
        );
        await expect(noGeneralUser.battle.simulate(buildBattleRequest())).resolves.toMatchObject({
            status: 'queued',
        });
        expect(transactionCalls).toBe(0);
        expect(battleSim.lastRequesterUserId).toBe('user-without-general');
    });

    it('does not expose queued results across authenticated users', async () => {
        const battleSim = new QueuedBattleSimTransport();
        const state: WorldStateRow = {
            id: 1,
            scenarioCode: 'default',
            currentYear: 200,
            currentMonth: 1,
            tickSeconds: 600,
            config: {},
            meta: {},
            updatedAt: new Date('2026-01-01T00:00:00Z'),
        };
        const owner = appRouter.createCaller(buildContext({ state, battleSim, userId: 'owner-user' }));
        const other = appRouter.createCaller(buildContext({ state, battleSim, userId: 'other-user' }));
        const response = await owner.battle.simulate(buildBattleRequest());
        battleSim.pushResult(response.jobId, 'owner-user', { result: true, reason: 'success', avgWar: 7 });

        await expect(owner.battle.getSimulation({ jobId: response.jobId })).resolves.toMatchObject({
            status: 'completed',
            payload: { avgWar: 7 },
        });
        await expect(other.battle.getSimulation({ jobId: response.jobId })).resolves.toEqual({
            status: 'queued',
            jobId: response.jobId,
        });
    });
});

describe('battle simulator general import permissions', () => {
    const state: WorldStateRow = {
        id: 1,
        scenarioCode: 'default',
        currentYear: 200,
        currentMonth: 1,
        tickSeconds: 600,
        config: {},
        meta: {},
        updatedAt: new Date('2026-01-01T00:00:00Z'),
    };

    const buildGeneral = (overrides: Record<string, unknown>) => ({
        id: 1,
        userId: 'same-nation-user',
        name: '관전자',
        npcState: 0,
        nationId: 1,
        leadership: 70,
        strength: 71,
        intel: 72,
        officerLevel: 1,
        injury: 0,
        rice: 9000,
        crew: 5000,
        crewTypeId: 100,
        atmos: 100,
        train: 100,
        experience: 400,
        horseCode: null,
        weaponCode: null,
        bookCode: null,
        itemCode: null,
        personalCode: null,
        special2Code: null,
        meta: {},
        ...overrides,
    });

    const actor = buildGeneral({ id: 1, userId: 'same-nation-user', nationId: 1 });
    const ally = buildGeneral({
        id: 2,
        userId: 'ally-user',
        name: '아군 장수',
        nationId: 1,
        officerLevel: 4,
        rice: 4321,
        crew: 3210,
        train: 97,
        atmos: 96,
        horseCode: 'che_적토마',
        weaponCode: 'che_의천검',
        bookCode: 'che_손자병법',
        itemCode: 'che_옥새',
        meta: {
            dex1: 10000,
            rank_warnum: 33,
            rank_killnum: 22,
            rank_killcrew: 1111,
        },
    });
    const foreignActor = buildGeneral({ id: 3, userId: 'foreign-user', nationId: 2 });
    const generals = [actor, ally, foreignActor];
    const db = {
        worldState: { findFirst: async () => state },
        general: {
            findFirst: async ({ where }: { where: { userId: string } }) =>
                generals.find((general) => general.userId === where.userId) ?? null,
            findUnique: async ({ where }: { where: { id: number } }) =>
                generals.find((general) => general.id === where.id) ?? null,
        },
    } as unknown as DatabaseClient;

    it('returns full ally details to the same nation but redacts them for another nation', async () => {
        const battleSim = new QueuedBattleSimTransport();
        const sameNation = appRouter.createCaller(buildContext({ state, battleSim, userId: 'same-nation-user', db }));
        const foreign = appRouter.createCaller(buildContext({ state, battleSim, userId: 'foreign-user', db }));

        const visible = await sameNation.battle.getGeneralDetail({ generalId: ally.id });
        expect(visible.general).toMatchObject({
            name: '아군 장수',
            officer_level: 4,
            horse: 'che_적토마',
            crew: 3210,
            rice: 4321,
            train: 97,
            atmos: 96,
            warnum: 33,
            killnum: 22,
            killcrew: 1111,
        });

        const redacted = await foreign.battle.getGeneralDetail({ generalId: ally.id });
        expect(redacted.general).toMatchObject({
            name: '아군 장수',
            officer_level: 1,
            horse: null,
            weapon: null,
            book: null,
            item: null,
            crew: 0,
            rice: 10000,
            dex1: 0,
            warnum: 0,
            killnum: 0,
            killcrew: 0,
        });
    });

    it('requires a game general only for server-side general import', async () => {
        const caller = appRouter.createCaller(
            buildContext({
                state,
                battleSim: new QueuedBattleSimTransport(),
                userId: 'user-without-general',
                db,
            })
        );

        await expect(caller.battle.getGeneralDetail({ generalId: ally.id })).rejects.toMatchObject({
            code: 'NOT_FOUND',
            message: 'General not found',
        });
    });
});
