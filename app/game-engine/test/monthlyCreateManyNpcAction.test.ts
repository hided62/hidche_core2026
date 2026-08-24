import { describe, expect, it, vi } from 'vitest';
import {
    LEGACY_RANDOM_GENERAL_FIRST_NAMES,
    LEGACY_RANDOM_GENERAL_LAST_NAMES,
    parseScenarioGeneralPoolCandidate,
    type City,
} from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createCreateManyNpcHandler } from '../src/turn/monthlyCreateManyNpcAction.js';
import { InMemoryReservedTurnStore } from '../src/turn/reservedTurnStore.js';
import { buildCommandEnv } from '../src/turn/reservedTurnCommands.js';
import type { TurnGeneral, TurnGeneralPoolEntry, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const buildCity = (id: number): City => ({
    id,
    name: `도시${id}`,
    nationId: 0,
    level: 4,
    state: 0,
    population: 10_000,
    populationMax: 20_000,
    agriculture: 1_000,
    agricultureMax: 2_000,
    commerce: 1_000,
    commerceMax: 2_000,
    security: 1_000,
    securityMax: 2_000,
    supplyState: 1,
    frontState: 0,
    defence: 1_000,
    defenceMax: 2_000,
    wall: 1_000,
    wallMax: 2_000,
    meta: {},
});

const buildGeneral = (id: number, patch: Partial<TurnGeneral> = {}): TurnGeneral => ({
    id,
    userId: null,
    name: '가가',
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 50, strength: 50, intelligence: 50 },
    experience: 0,
    dedication: 0,
    officerLevel: 12,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: 1_000,
    rice: 1_000,
    crew: 0,
    crewTypeId: 1100,
    train: 0,
    atmos: 0,
    age: 30,
    npcState: 0,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    lastTurn: { command: '휴식' },
    turnTime: new Date('0200-05-01T00:00:00.000Z'),
    recentWarTime: null,
    meta: { killturn: 1_000 },
    ...patch,
});

const buildHarness = (
    generals: TurnGeneral[] = [],
    cityCount = 2,
    generalPoolEntries?: TurnGeneralPoolEntry[],
    poolName = 'SPoolUnderU30'
) => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 200,
        currentMonth: 5,
        tickSeconds: 600,
        lastTurnTime: new Date('0200-05-01T00:00:00.000Z'),
        meta: { hiddenSeed: 'create-many-npc-fixture' },
    };
    const snapshot: TurnWorldSnapshot = {
        scenarioConfig: {
            stat:
                poolName === 'SPoolUnderU100'
                    ? { total: 165, min: 15, max: 80, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 }
                    : { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
            iconPath: '',
            map: generalPoolEntries
                ? {
                      targetGeneralPool: poolName,
                      ...(poolName === 'SPoolUnderU100' ? { centennialNpcDexTargetRatio: 0.4 } : {}),
                  }
                : {},
            const: {
                defaultStatNPCTotal: 150,
                defaultStatNPCMin: 10,
                defaultStatNPCMax: 50,
                retirementYear: 80,
                randGenFirstName: ['가'],
                randGenMiddleName: [''],
                randGenLastName: ['가'],
                availablePersonality: ['che_안전'],
            },
            environment: { mapName: 'test', unitSet: 'default' },
        },
        map: {
            id: 'test',
            name: 'test',
            cities: [],
            defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
        },
        generals,
        cities: Array.from({ length: cityCount }, (_, index) => buildCity(index + 1)),
        nations: [],
        troops: [],
        diplomacy: [],
        events: [],
        initialEvents: [],
        ...(generalPoolEntries ? { generalPoolEntries } : {}),
    };
    const world = new InMemoryTurnWorld(state, snapshot, {
        schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
    });
    const prisma = {
        generalTurn: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
        nationTurn: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    };
    const reservedTurns = new InMemoryReservedTurnStore(prisma as never, {
        maxGeneralTurns: 30,
        maxNationTurns: 12,
    });
    const commandEnv = buildCommandEnv(snapshot.scenarioConfig);
    const handler = createCreateManyNpcHandler({
        getWorld: () => world,
        reservedTurns,
        env: commandEnv,
    });
    const environment = {
        year: 200,
        month: 5,
        startyear: 190,
        currentEventID: 1,
        turnTime: new Date('0200-05-01T00:00:00.000Z'),
    };
    return { world, reservedTurns, handler, environment, commandEnv };
};

describe('CreateManyNPC monthly action', () => {
    it('creates exactly 50 ordinary M generals without fill-count expansion', async () => {
        const { world, reservedTurns, handler, environment } = buildHarness();

        await handler([50, 0], environment, {
            id: 1,
            targetCode: 'month',
            priority: 1,
            condition: true,
            action: [],
            meta: {},
        });

        const created = world.peekDirtyState().createdGenerals;
        expect(created).toHaveLength(50);
        expect(created.every((general) => general.npcState === 3 && general.name.startsWith('ⓜ'))).toBe(true);
        expect(reservedTurns.peekDirtyState().generalInitializationIds).toHaveLength(50);
        expect(world.peekDirtyState().logs.map((log) => log.text)).toContain('장수 <C>50</>명이 <S>등장</>하였습니다.');
    });

    it('uses and consumes an available U30 candidate without random-name or random-stat fallback', async () => {
        const info = {
            generalName: '풀장수',
            leadership: 69,
            strength: 12,
            intel: 80,
            specialDomestic: 'che_event_징병',
            dex: [10, 20, 30, 40, 50],
            imgsvr: 1,
            picture: 'pool.gif',
        };
        const entry: TurnGeneralPoolEntry = {
            id: 31,
            uniqueName: info.generalName,
            ownerUserId: null,
            generalId: null,
            reservedUntil: null,
            reservedUntilTick: null,
            candidate: parseScenarioGeneralPoolCandidate({ id: 31, uniqueName: info.generalName, info }),
        };
        const { world, handler, environment } = buildHarness([buildGeneral(1)], 2, [entry]);

        await handler([1, 0], environment, {
            id: 1,
            targetCode: 'month',
            priority: 1,
            condition: true,
            action: [],
            meta: {},
        });

        const created = world.peekDirtyState().createdGenerals[0]!;
        expect(created).toMatchObject({
            name: 'ⓜ풀장수',
            stats: { leadership: 69, strength: 12, intelligence: 80 },
            picture: 'pool.gif',
            imageServer: 1,
            role: {
                specialDomestic: 'che_event_징병',
            },
            meta: {
                dex1: 10,
                dex2: 20,
                dex3: 30,
                dex4: 40,
                dex5: 50,
                scenarioGeneralPoolClaim: {
                    poolEntryId: 31,
                    uniqueName: '풀장수',
                    claimedAt: environment.turnTime.toISOString(),
                },
            },
        });
        expect(world.listGeneralPoolCandidates(environment.turnTime)).toEqual([]);
    });

    it('keeps the ordinary NPC RNG path before applying the S100 .9/.4 target', async () => {
        const info = {
            generalName: '100기후보',
            leadership: 100,
            strength: 80,
            intel: 10,
            specialDomestic: 'che_event_징병',
            dex: [900_000, 800_000, 700_000, 600_000, 500_000],
            imgsvr: 1,
            picture: 'centennial.gif',
            event100Growth: true,
        };
        const entry: TurnGeneralPoolEntry = {
            id: 100,
            uniqueName: 'A1000100',
            ownerUserId: null,
            generalId: null,
            reservedUntil: null,
            reservedUntilTick: null,
            candidate: parseScenarioGeneralPoolCandidate({ id: 100, uniqueName: 'A1000100', info }),
        };
        const { world, handler, environment } = buildHarness([buildGeneral(1)], 2, [entry], 'SPoolUnderU100');
        const currentEnvironment = { ...environment, year: 195, month: 1, startyear: 180 };

        await handler([1, 0], currentEnvironment, {
            id: 1,
            targetCode: 'month',
            priority: 1,
            condition: true,
            action: [],
            meta: {},
        });

        const created = world.peekDirtyState().createdGenerals[0]!;
        expect(created).toMatchObject({
            name: 'ⓜ100기후보',
            stats: { leadership: 93, strength: 73 },
            picture: 'centennial.gif',
            role: { specialDomestic: 'che_event_징병' },
            meta: {
                dex1: 360_000,
                dex2: 320_000,
                dex3: 280_000,
                dex4: 240_000,
                dex5: 200_000,
                scenarioGeneralPoolClaim: { poolEntryId: 100, uniqueName: 'A1000100' },
                event100_allstar: {
                    targetId: 'A1000100',
                    milestone: 4,
                    dexTargetRatio: 0.4,
                },
            },
        });
        expect(created.stats.intelligence).toBeGreaterThanOrEqual(10);
        expect(created.stats).not.toEqual({ leadership: 100, strength: 80, intelligence: 10 });
    });

    it('creates the legacy random-name NPC state and initializes all 30 reserved turns', async () => {
        const { world, reservedTurns, handler, environment } = buildHarness([buildGeneral(1)]);

        await handler([1, 0], environment, {
            id: 1,
            targetCode: 'month',
            priority: 1,
            condition: true,
            action: [],
            meta: {},
        });

        const created = world.peekDirtyState().createdGenerals[0]!;
        expect({
            id: created.id,
            name: created.name,
            cityId: created.cityId,
            stats: created.stats,
            experience: created.experience,
            dedication: created.dedication,
            age: created.age,
            bornYear: created.bornYear,
            deadYear: created.deadYear,
            affinity: created.affinity,
            personality: created.role.personality,
            turnTime: created.turnTime.toISOString(),
            meta: created.meta,
        }).toMatchInlineSnapshot(`
          {
            "affinity": 94,
            "age": 24,
            "bornYear": 176,
            "cityId": 2,
            "deadYear": 226,
            "dedication": 2400,
            "experience": 2400,
            "id": 2,
            "meta": {
              "belong": 0,
              "dedlevel": 1,
              "dex1": 0,
              "dex2": 0,
              "dex3": 0,
              "dex4": 0,
              "dex5": 0,
              "killturn": 323,
              "legacyScanOrder": 1,
              "npcType": 3,
              "npc_org": 3,
              "specage": 27,
              "specage2": 28,
            },
            "name": "ⓜ가가2",
            "personality": "che_안전",
            "stats": {
              "intelligence": 47,
              "leadership": 11,
              "strength": 92,
            },
            "turnTime": "0200-05-01T00:05:45.821Z",
          }
        `);
        expect(created.turnTick).toBeTypeOf('number');
        expect(created.turnTick! - world.dateToGameTick(created.turnTime)).toBeGreaterThan(0);
        expect(created.turnTick! - world.dateToGameTick(created.turnTime)).toBeLessThan(60);
        expect(reservedTurns.getGeneralTurns(created.id)).toHaveLength(30);
        expect(reservedTurns.peekDirtyState()).toEqual({
            generalIds: [],
            generalInitializationIds: [created.id],
            generalLeaseIds: [],
            nationKeys: [],
            nationInitializationKeys: [],
            nationLeaseKeys: [],
        });
        expect(world.peekDirtyState().logs).toMatchInlineSnapshot(`
          [
            {
              "category": "ACTION",
              "format": 4,
              "month": 5,
              "scope": "SYSTEM",
              "text": "<Y>ⓜ가가2</>라는 장수가 <S>등장</>하였습니다.",
              "year": 200,
            },
            {
              "category": "HISTORY",
              "format": 8,
              "month": 5,
              "scope": "SYSTEM",
              "text": "장수 <C>1</>명이 <S>등장</>했습니다.",
              "year": 200,
            },
          ]
        `);
    });

    it('uses the legacy fill count and does not reserve names created in the same batch', async () => {
        const { world, handler, environment } = buildHarness([
            buildGeneral(1),
            buildGeneral(2, { name: '부장', officerLevel: 0 }),
        ]);

        await handler([1, 5], environment, {
            id: 1,
            targetCode: 'month',
            priority: 1,
            condition: true,
            action: [],
            meta: {},
        });

        const created = world.peekDirtyState().createdGenerals;
        expect(created).toHaveLength(4);
        expect(created.map((general) => general.name)).toEqual(['ⓜ가가2', 'ⓜ가가2', 'ⓜ가가2', 'ⓜ가가2']);
    });

    it('returns without logs or RNG-visible state when both counts are non-positive', async () => {
        const { world, reservedTurns, handler, environment } = buildHarness();

        await handler([0, 0], environment, {
            id: 1,
            targetCode: 'month',
            priority: 1,
            condition: true,
            action: [],
            meta: {},
        });

        expect(world.peekDirtyState().createdGenerals).toEqual([]);
        expect(world.peekDirtyState().logs).toEqual([]);
        expect(reservedTurns.peekDirtyState().generalInitializationIds).toEqual([]);
    });

    it.skipIf(!process.env.REF_HIDDEN_SEED)('matches the fixed-seed legacy fixture including RNG order', async () => {
        const { world, reservedTurns, handler, environment, commandEnv } = buildHarness([], 94);
        world.updateWorldMeta({ hiddenSeed: process.env.REF_HIDDEN_SEED });
        commandEnv.npcStatTotal = 150;
        commandEnv.npcStatMin = 10;
        commandEnv.npcStatMax = 75;
        commandEnv.randomGeneralFirstNames = [...LEGACY_RANDOM_GENERAL_FIRST_NAMES];
        commandEnv.randomGeneralMiddleNames = [''];
        commandEnv.randomGeneralLastNames = [...LEGACY_RANDOM_GENERAL_LAST_NAMES];
        commandEnv.availablePersonalities = [
            'che_안전',
            'che_유지',
            'che_재간',
            'che_출세',
            'che_할거',
            'che_정복',
            'che_패권',
            'che_의협',
            'che_대의',
            'che_왕좌',
        ];

        await handler(
            [2, 0],
            {
                ...environment,
                year: 193,
                month: 5,
                startyear: 190,
                turnTime: new Date('0193-05-01T00:00:00.000Z'),
            },
            {
                id: 1,
                targetCode: 'month',
                priority: 1,
                condition: true,
                action: [],
                meta: {},
            }
        );

        expect(
            world.peekDirtyState().createdGenerals.map((general) => ({
                name: general.name,
                cityId: general.cityId,
                stats: general.stats,
                experience: general.experience,
                dedication: general.dedication,
                age: general.age,
                bornYear: general.bornYear,
                deadYear: general.deadYear,
                affinity: general.affinity,
                personality: general.role.personality,
                turnTime: general.turnTime.toISOString(),
                killturn: general.meta.killturn,
                specage: general.meta.specage,
                specage2: general.meta.specage2,
            }))
        ).toEqual([
            {
                name: 'ⓜ심송',
                cityId: 33,
                stats: { leadership: 15, strength: 67, intelligence: 68 },
                experience: 2_000,
                dedication: 2_000,
                age: 20,
                bornYear: 173,
                deadYear: 238,
                affinity: 144,
                personality: 'che_유지',
                turnTime: '0193-05-01T00:08:28.195Z',
                killturn: 551,
                specage: 24,
                specage2: 29,
            },
            {
                name: 'ⓜ하후후',
                cityId: 60,
                stats: { leadership: 63, strength: 13, intelligence: 74 },
                experience: 2_000,
                dedication: 2_000,
                age: 20,
                bornYear: 173,
                deadYear: 236,
                affinity: 141,
                personality: 'che_정복',
                turnTime: '0193-05-01T00:08:21.776Z',
                killturn: 528,
                specage: 24,
                specage2: 29,
            },
        ]);
        expect(reservedTurns.peekDirtyState().generalInitializationIds).toEqual([1, 2]);
    });
});
