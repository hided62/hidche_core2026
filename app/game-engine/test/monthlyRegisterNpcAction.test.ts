import { describe, expect, it, vi } from 'vitest';
import { PERSONALITY_TRAIT_KEYS, type City, type Nation } from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createRegisterNpcHandler } from '../src/turn/monthlyRegisterNpcAction.js';
import { InMemoryReservedTurnStore } from '../src/turn/reservedTurnStore.js';
import { buildCommandEnv } from '../src/turn/reservedTurnCommands.js';
import type { TurnEvent, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const buildCity = (id: number, nationId: number): City => ({
    id,
    name: `도시${id}`,
    nationId,
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

const buildNation = (id: number): Nation => ({
    id,
    name: `국가${id}`,
    color: '#777777',
    capitalCityId: id,
    chiefGeneralId: null,
    gold: 1_000,
    rice: 1_000,
    power: 0,
    level: 1,
    typeCode: 'che_중립',
    meta: {},
});

const event: TurnEvent = {
    id: 1,
    targetCode: 'month',
    priority: 1_000,
    condition: true,
    action: [],
    meta: {},
};

const buildHarness = (options: { fiction?: number; seed?: string; fixtureCity?: boolean } = {}) => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 200,
        currentMonth: 1,
        tickSeconds: 600,
        lastTurnTime: new Date('0200-01-01T00:00:00.000Z'),
        meta: { hiddenSeed: options.seed ?? 'register-npc-fixture' },
    };
    const snapshot: TurnWorldSnapshot = {
        scenarioConfig: {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 70 },
            iconPath: '.',
            map: {},
            const: {
                retirementYear: 80,
                availablePersonality: ['che_안전', 'che_유지'],
            },
            environment: { mapName: 'test', unitSet: 'default' },
        },
        scenarioMeta: {
            title: 'test',
            startYear: 190,
            life: null,
            fiction: null,
            history: [],
            ignoreDefaultEvents: false,
        },
        worldConfig: { fiction: options.fiction ?? 0, showImgLevel: 3 },
        map: {
            id: 'test',
            name: 'test',
            cities: [],
            defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
        },
        generals: [],
        cities: [
            buildCity(1, 1),
            buildCity(2, 1),
            buildCity(3, 0),
            ...(options.fixtureCity ? [buildCity(33, 1)] : []),
        ],
        nations: [buildNation(1)],
        troops: [],
        diplomacy: [],
        events: [],
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
    const env = buildCommandEnv(snapshot.scenarioConfig);
    const environment = {
        year: 200,
        month: 1,
        startyear: 190,
        currentEventID: 1,
        turnTime: state.lastTurnTime,
    };
    return { world, reservedTurns, env, environment, snapshot };
};

describe('RegNPC and RegNeutralNPC monthly actions', () => {
    it('registers a 14-year-old NPC with the legacy prefix, officer override, log, and reserved turns', async () => {
        const { world, reservedTurns, env, environment, snapshot } = buildHarness();
        const handler = createRegisterNpcHandler({
            actionName: 'RegNPC',
            getWorld: () => world,
            reservedTurns,
            env,
            worldConfig: snapshot.worldConfig,
        });

        await handler(
            [77, '등장장수', null, 1, '도시2', 60, 50, 40, 7, 186, 240, '유지', '인덕', '대사'],
            environment,
            event
        );

        const created = world.peekDirtyState().createdGenerals[0]!;
        expect(created.turnTick).toBeTypeOf('number');
        expect(created.turnTick! - world.dateToGameTick(created.turnTime)).toBeGreaterThan(0);
        expect(created.turnTick! - world.dateToGameTick(created.turnTime)).toBeLessThan(60);
        expect(created).toMatchObject({
            name: 'ⓝ등장장수',
            nationId: 1,
            cityId: 2,
            stats: { leadership: 60, strength: 50, intelligence: 40 },
            officerLevel: 1,
            experience: 1_400,
            dedication: 1_400,
            age: 14,
            npcState: 2,
            bornYear: 186,
            deadYear: 240,
            affinity: 77,
            picture: 'default.jpg',
            role: {
                personality: 'che_유지',
                specialDomestic: 'che_인덕',
                specialWar: null,
            },
            meta: {
                npcType: 2,
                npc_org: 2,
                text: '대사',
            },
        });
        expect(reservedTurns.getGeneralTurns(created.id)).toHaveLength(30);
        expect(world.peekDirtyState().logs).toEqual([
            expect.objectContaining({
                text: '<Y>ⓝ등장장수</>가 성인이 되어 <S>등장</>했습니다.',
                year: 200,
                month: 1,
            }),
        ]);
    });

    it('uses the neutral prefix/type and the legacy fixed RNG order for implicit fields', async () => {
        const { world, reservedTurns, env, environment, snapshot } = buildHarness();
        const handler = createRegisterNpcHandler({
            actionName: 'RegNeutralNPC',
            getWorld: () => world,
            reservedTurns,
            env,
            worldConfig: snapshot.worldConfig,
        });

        await handler([0, '재야장수', null, 0, null, 45, 55, 65, 180, 245, null, '무쌍', ''], environment, event);

        const created = world.peekDirtyState().createdGenerals[0]!;
        expect({
            name: created.name,
            nationId: created.nationId,
            cityId: created.cityId,
            officerLevel: created.officerLevel,
            affinity: created.affinity,
            personality: created.role.personality,
            specialDomestic: created.role.specialDomestic,
            specialWar: created.role.specialWar,
            turnTime: created.turnTime.toISOString(),
            killturn: created.meta.killturn,
            npcType: created.npcState,
            npcOrg: created.meta.npc_org,
        }).toMatchInlineSnapshot(`
          {
            "affinity": 47,
            "cityId": 1,
            "killturn": 547,
            "name": "ⓤ재야장수",
            "nationId": 0,
            "npcOrg": 6,
            "npcType": 6,
            "officerLevel": 0,
            "personality": "che_안전",
            "specialDomestic": null,
            "specialWar": "che_무쌍",
            "turnTime": "0200-01-01T00:04:36.545Z",
          }
        `);
    });

    it('forces a newly adult general to neutral in fiction mode', async () => {
        const { world, reservedTurns, env, environment, snapshot } = buildHarness({ fiction: 1 });
        const handler = createRegisterNpcHandler({
            actionName: 'RegNPC',
            getWorld: () => world,
            reservedTurns,
            env,
            worldConfig: snapshot.worldConfig,
        });

        await handler([10, '가상장수', null, 1, null, 50, 50, 50, 5, 186, 240, '안전', '', ''], environment, event);

        expect(world.peekDirtyState().createdGenerals[0]).toMatchObject({
            name: 'ⓝ가상장수',
            nationId: 0,
            officerLevel: 0,
        });
    });

    it('projects legacy numeric icon indexes to shared jpg paths', async () => {
        const { world, reservedTurns, env, environment, snapshot } = buildHarness();
        const handler = createRegisterNpcHandler({
            actionName: 'RegNPC',
            getWorld: () => world,
            reservedTurns,
            env,
            worldConfig: snapshot.worldConfig,
        });

        await handler([10, '도상', 1001, 0, 1, 50, 50, 50, 0, 180, 240, '안전', '', ''], environment, event);

        expect(world.peekDirtyState().createdGenerals[0]?.picture).toBe('1001.jpg');
    });

    it('consumes fill-time random values but does not insert a dead or underage general', async () => {
        const { world, reservedTurns, env, environment, snapshot } = buildHarness();
        const handler = createRegisterNpcHandler({
            actionName: 'RegNPC',
            getWorld: () => world,
            reservedTurns,
            env,
            worldConfig: snapshot.worldConfig,
        });

        await handler([0, '사망', null, 1, null, 50, 50, 50, 1, 170, 200, null, '', ''], environment, event);
        await handler([0, '미성년', null, 1, null, 50, 50, 50, 1, 190, 250, null, '', ''], environment, event);

        expect(world.peekDirtyState().createdGenerals).toEqual([]);
        expect(world.peekDirtyState().logs).toEqual([]);
        expect(reservedTurns.peekDirtyState().generalInitializationIds).toEqual([]);
    });

    it.skipIf(!process.env.REF_HIDDEN_SEED)('matches the fixed-seed legacy RegNPC fixture', async () => {
        const { world, reservedTurns, env, environment, snapshot } = buildHarness({
            seed: process.env.REF_HIDDEN_SEED,
            fixtureCity: true,
        });
        env.availablePersonalities = [...PERSONALITY_TRAIT_KEYS];
        const handler = createRegisterNpcHandler({
            actionName: 'RegNPC',
            getWorld: () => world,
            reservedTurns,
            env,
            worldConfig: snapshot.worldConfig,
        });

        await handler(
            [0, '등록장수', null, 0, 33, 60, 50, 40, 7, 186, 240, null, '인덕', '등록 대사'],
            environment,
            event
        );

        const created = world.peekDirtyState().createdGenerals[0]!;
        expect({
            name: created.name,
            nationId: created.nationId,
            cityId: created.cityId,
            officerLevel: created.officerLevel,
            affinity: created.affinity,
            personality: created.role.personality,
            specialDomestic: created.role.specialDomestic,
            specialWar: created.role.specialWar,
            specAge: created.meta.specage,
            specAge2: created.meta.specage2,
            turnTime: created.turnTime.toISOString(),
            killturn: created.meta.killturn,
        }).toEqual({
            name: 'ⓝ등록장수',
            nationId: 0,
            cityId: 33,
            officerLevel: 0,
            affinity: 126,
            personality: 'che_출세',
            specialDomestic: 'che_인덕',
            specialWar: null,
            specAge: 17,
            specAge2: 20,
            turnTime: '0200-01-01T00:09:00.782Z',
            killturn: 489,
        });
    });

    it.skipIf(!process.env.REF_HIDDEN_SEED)('matches the fixed-seed legacy RegNeutralNPC fixture', async () => {
        const { world, reservedTurns, env, environment, snapshot } = buildHarness({
            seed: process.env.REF_HIDDEN_SEED,
            fixtureCity: true,
        });
        env.availablePersonalities = [...PERSONALITY_TRAIT_KEYS];
        const handler = createRegisterNpcHandler({
            actionName: 'RegNeutralNPC',
            getWorld: () => world,
            reservedTurns,
            env,
            worldConfig: snapshot.worldConfig,
        });

        await handler(
            [0, '등록재야', null, 0, 33, 45, 55, 65, 180, 245, null, '무쌍', ''],
            environment,
            event
        );

        const created = world.peekDirtyState().createdGenerals[0]!;
        expect({
            name: created.name,
            nationId: created.nationId,
            cityId: created.cityId,
            officerLevel: created.officerLevel,
            affinity: created.affinity,
            personality: created.role.personality,
            specialDomestic: created.role.specialDomestic,
            specialWar: created.role.specialWar,
            specAge: created.meta.specage,
            specAge2: created.meta.specage2,
            turnTime: created.turnTime.toISOString(),
            killturn: created.meta.killturn,
        }).toEqual({
            name: 'ⓤ등록재야',
            nationId: 0,
            cityId: 33,
            officerLevel: 0,
            affinity: 103,
            personality: 'che_출세',
            specialDomestic: null,
            specialWar: 'che_무쌍',
            specAge: 23,
            specAge2: 25,
            turnTime: '0200-01-01T00:09:50.378Z',
            killturn: 540,
        });
    });
});
