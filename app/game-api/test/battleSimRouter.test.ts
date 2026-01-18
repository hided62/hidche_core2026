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
    private readonly results = new Map<string, BattleSimResultPayload>();

    async simulate(payload: BattleSimJobPayload) {
        this.simulateCalls += 1;
        this.lastPayload = payload;
        return { status: 'queued', jobId: 'job-1' } as const;
    }

    async getSimulationResult(jobId: string) {
        return this.results.get(jobId) ?? null;
    }

    pushResult(jobId: string, payload: BattleSimResultPayload) {
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

const buildContext = (options: { state: WorldStateRow; battleSim: BattleSimTransport }): GameApiContext => {
    const db = {
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
    const auth: GameSessionTokenPayload = {
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
        turnDaemon: new InMemoryTurnDaemonTransport(),
        battleSim: options.battleSim,
        profile,
        auth,
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
            config: {},
            meta: {},
            updatedAt: new Date('2026-01-01T00:00:00Z'),
        };
        const caller = appRouter.createCaller(buildContext({ state, battleSim }));

        const response = await caller.battle.simulate(buildBattleRequest());
        expect(response.status).toBe('queued');
        expect(battleSim.simulateCalls).toBe(1);

        const queued = await caller.battle.getSimulation({ jobId: response.jobId });
        expect(queued.status).toBe('queued');

        battleSim.pushResult(response.jobId, { result: true, reason: 'success', avgWar: 1 });

        const completed = await caller.battle.getSimulation({ jobId: response.jobId });
        expect(completed.status).toBe('completed');
        expect(completed.payload?.result).toBe(true);
    });
});
