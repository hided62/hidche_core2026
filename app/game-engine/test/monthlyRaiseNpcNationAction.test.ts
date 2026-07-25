import { describe, expect, it, vi } from 'vitest';
import { PERSONALITY_TRAIT_KEYS, type City, type MapDefinition, type Nation } from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createRaiseNpcNationHandler } from '../src/turn/monthlyRaiseNpcNationAction.js';
import { InMemoryReservedTurnStore } from '../src/turn/reservedTurnStore.js';
import { buildCommandEnv } from '../src/turn/reservedTurnCommands.js';
import type { TurnEvent, TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const buildCity = (id: number, nationId: number, level = 5): City => ({
    id,
    name: `도시${id}`,
    nationId,
    level,
    state: 0,
    population: 10_000 + id,
    populationMax: 50_000 + id,
    agriculture: 1_000 + id,
    agricultureMax: 5_000 + id,
    commerce: 2_000 + id,
    commerceMax: 6_000 + id,
    security: 3_000 + id,
    securityMax: 7_000 + id,
    supplyState: 1,
    frontState: 0,
    defence: 4_000 + id,
    defenceMax: 8_000 + id,
    wall: 5_000 + id,
    wallMax: 9_000 + id,
    meta: { trust: 50 },
});

const buildNation = (id: number): Nation => ({
    id,
    name: `국가${id}`,
    color: '#777777',
    capitalCityId: 1,
    chiefGeneralId: 1,
    gold: 1_000,
    rice: 1_000,
    power: 0,
    level: 2,
    typeCode: 'che_유가',
    meta: { tech: 120 },
});

const buildGeneral = (): TurnGeneral => ({
    id: 1,
    userId: null,
    name: '군주',
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 50, strength: 50, intelligence: 50 },
    experience: 0,
    dedication: 0,
    officerLevel: 12,
    role: {
        personality: 'che_안전',
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
    bornYear: 170,
    deadYear: 250,
    affinity: 1,
    picture: 'default.jpg',
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    lastTurn: { command: '휴식' },
    turnTime: new Date('0200-01-01T00:00:00.000Z'),
    recentWarTime: null,
    meta: { killturn: 1_000 },
});

const map: MapDefinition = {
    id: 'test',
    name: 'test',
    cities: [1, 2, 3, 4, 5].map((id) => ({
        id,
        name: `도시${id}`,
        level: id === 3 ? 4 : 5,
        region: 1,
        position: { x: id, y: 0 },
        connections: [id - 1, id + 1].filter((target) => target >= 1 && target <= 5),
        max: {
            population: 50_000 + id,
            agriculture: 5_000 + id,
            commerce: 6_000 + id,
            security: 7_000 + id,
            defence: 8_000 + id,
            wall: 9_000 + id,
        },
        initial: {
            population: 10_000 + id,
            agriculture: 1_000 + id,
            commerce: 2_000 + id,
            security: 3_000 + id,
            defence: 4_000 + id,
            wall: 5_000 + id,
        },
    })),
};

const event: TurnEvent = {
    id: 1,
    targetCode: 'month',
    priority: 1_000,
    condition: true,
    action: [['RaiseNPCNation']],
    meta: {},
};

const buildHarness = (archivedNationMaxId = 0, hiddenSeed = 'raise-npc-nation-fixture') => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 200,
        currentMonth: 1,
        tickSeconds: 600,
        lastTurnTime: new Date('0200-01-01T00:00:00.000Z'),
        meta: { hiddenSeed, serverId: 'fixture-server' },
    };
    const snapshot: TurnWorldSnapshot = {
        scenarioConfig: {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 70 },
            iconPath: '.',
            map: {},
            const: {
                retirementYear: 80,
                availablePersonality: ['che_안전'],
                randGenFirstName: ['가'],
                randGenMiddleName: [''],
                randGenLastName: ['나'],
            },
            environment: { mapName: 'test', unitSet: 'default' },
        },
        map,
        generals: [buildGeneral()],
        cities: [
            buildCity(1, 1),
            buildCity(2, 0),
            buildCity(3, 0, 4),
            buildCity(4, 0),
            buildCity(5, 0, 4),
        ],
        nations: [buildNation(1)],
        troops: [],
        diplomacy: [],
        events: [event],
        initialEvents: [],
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
    const handler = createRaiseNpcNationHandler({
        getWorld: () => world,
        reservedTurns,
        env: commandEnv,
        map,
        loadArchivedNationMaxId: vi.fn().mockResolvedValue(archivedNationMaxId),
    });
    return {
        world,
        reservedTurns,
        commandEnv,
        handler,
        environment: {
            year: 200,
            month: 1,
            startyear: 190,
            currentEventID: 1,
            turnTime: state.lastTurnTime,
        },
    };
};

describe('RaiseNPCNation monthly action', () => {
    it('creates only distance-qualified NPC nations and initializes their ruler and turns', async () => {
        const { world, reservedTurns, handler, environment } = buildHarness();

        await handler([], environment, event);

        const dirty = world.peekDirtyState();
        expect(dirty.createdNations).toHaveLength(1);
        expect(dirty.createdGenerals).toHaveLength(1);
        expect(dirty.createdNations[0]).toMatchInlineSnapshot(`
          {
            "capitalCityId": 4,
            "chiefGeneralId": 2,
            "color": "#2E8B57",
            "gold": 0,
            "id": 2,
            "level": 2,
            "meta": {
              "bill": 100,
              "can_국기변경": 1,
              "gennum": 1,
              "infoText": "우리도 할 수 있다! 도시4군",
              "rate": 15,
              "scout": 0,
              "strategicCommandLimit": 24,
              "surrenderLimit": 72,
              "tech": 120,
              "war": 0,
            },
            "name": "ⓤ도시4",
            "power": 0,
            "rice": 2000,
            "typeCode": "che_오두미도",
          }
        `);
        expect(dirty.createdGenerals[0]).toMatchObject({
            id: 2,
            name: 'ⓤ도시4태수',
            nationId: 2,
            cityId: 4,
            officerLevel: 12,
            age: 20,
            npcState: 6,
            bornYear: 180,
            deadYear: 260,
            meta: { killturn: 240, npc_org: 6 },
        });
        expect(world.getCityById(2)?.nationId).toBe(0);
        expect(world.getCityById(4)).toMatchObject({
            nationId: 2,
            population: 10_001,
            agriculture: 1_001,
            commerce: 2_001,
            security: 3_001,
            defence: 4_001,
            wall: 5_001,
            meta: { trust: 100 },
        });
        expect(world.getCityById(5)?.nationId).toBe(0);
        expect(reservedTurns.getGeneralTurns(2)).toHaveLength(30);
        expect(reservedTurns.peekDirtyState().nationInitializationKeys).toEqual([
            '2:12',
            '2:11',
            '2:10',
            '2:9',
        ]);
        expect(dirty.logs).toEqual([
            expect.objectContaining({
                category: 'HISTORY',
                text: '<L><b>【공지】</b></>공백지에 임의의 국가가 생성되었습니다.',
            }),
        ]);
    });

    it('starts after the archived nation id for the same server', async () => {
        const { world, handler, environment } = buildHarness(9);

        await handler([], environment, event);

        expect(world.peekDirtyState().createdNations[0]?.id).toBe(10);
    });

    it.skipIf(!process.env.REF_HIDDEN_SEED)('matches the fixed-seed legacy nation and ruler fields', async () => {
        const { world, handler, commandEnv, environment } = buildHarness(99, process.env.REF_HIDDEN_SEED);
        commandEnv.availablePersonalities = [...PERSONALITY_TRAIT_KEYS];

        await handler([], environment, event);

        const nation = world.peekDirtyState().createdNations[0]!;
        const ruler = world.peekDirtyState().createdGenerals[0]!;
        expect({
            id: nation.id,
            color: nation.color,
            typeCode: nation.typeCode,
            tech: nation.meta.tech,
            ruler: {
                stats: ruler.stats,
                affinity: ruler.affinity,
                personality: ruler.role.personality,
                turnTime: ruler.turnTime.toISOString(),
                killturn: ruler.meta.killturn,
                specAge: ruler.meta.specage,
                specAge2: ruler.meta.specage2,
            },
        }).toEqual({
            id: 100,
            color: '#FFA500',
            typeCode: 'che_음양가',
            tech: 120,
            ruler: {
                stats: { leadership: 70, strength: 65, intelligence: 15 },
                affinity: 141,
                personality: 'che_패권',
                turnTime: '0200-01-01T00:08:56.503Z',
                killturn: 240,
                specAge: 23,
                specAge2: 25,
            },
        });
    });
});
