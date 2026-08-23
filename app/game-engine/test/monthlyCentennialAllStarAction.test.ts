import { describe, expect, it } from 'vitest';
import {
    CENTENNIAL_ALL_STAR_AUX_KEY,
    LogCategory,
    LogFormat,
    LogScope,
    calculateCentennialUserInitialStats,
    initialCentennialAllStarAux,
    type CentennialAllStarRules,
    type CentennialAllStarTarget,
} from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createAdvanceCentennialAllStarHandler } from '../src/turn/monthlyCentennialAllStarAction.js';
import type { TurnEvent, TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const event: TurnEvent = {
    id: 1,
    targetCode: 'month',
    priority: 8_000,
    condition: true,
    action: ['AdvanceCentennialAllStar'],
    meta: {},
};

const rules: CentennialAllStarRules = {
    defaultStatMin: 15,
    defaultStatMax: 80,
    defaultStatTotal: 165,
    maxStatLevel: 255,
    defaultSpecialDomestic: 'None',
    dexLimit: 1_000_000,
};

const target: CentennialAllStarTarget = {
    uniqueName: 'A1000001',
    generalName: '1·조민',
    leadership: 100,
    strength: 80,
    intel: 10,
    dex: [900_000, 800_000, 700_000, 600_000, 500_000],
    specialDomestic: 'che_event_무쌍',
};

const withTargetMeta = (
    userInitialStats: ReturnType<typeof calculateCentennialUserInitialStats> | null = null
): TurnGeneral['meta'] => {
    const meta: TurnGeneral['meta'] = {
        killturn: 5,
        dex1: 0,
        dex2: 0,
        dex3: 0,
        dex4: 0,
        dex5: 0,
    };
    const mutable: Record<string, unknown> = meta;
    mutable[CENTENNIAL_ALL_STAR_AUX_KEY] = initialCentennialAllStarAux(target, rules, userInitialStats);
    return meta;
};

const buildGeneral = (options: {
    id: number;
    npcState: number;
    stats: TurnGeneral['stats'];
    meta?: TurnGeneral['meta'];
}): TurnGeneral => ({
    id: options.id,
    userId: options.npcState === 0 ? `user-${options.id}` : null,
    name: `장수${options.id}`,
    nationId: 0,
    cityId: 1,
    troopId: 0,
    stats: options.stats,
    experience: 0,
    dedication: 0,
    officerLevel: 0,
    role: {
        personality: 'che_안전',
        specialDomestic: 'None',
        specialWar: 'None',
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: 1_000,
    rice: 1_000,
    crew: 0,
    crewTypeId: 1100,
    train: 0,
    atmos: 0,
    age: 20,
    startAge: 20,
    npcState: options.npcState,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: options.meta ?? { killturn: 5 },
    lastTurn: { command: '휴식' },
    turnTime: new Date('0186-01-01T00:00:00.000Z'),
});

const buildWorld = (generals: TurnGeneral[]): InMemoryTurnWorld => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 186,
        currentMonth: 1,
        tickSeconds: 600,
        lastTurnTime: new Date('0186-01-01T00:00:00.000Z'),
        meta: { hiddenSeed: 'monthly-centennial-fixture' },
    };
    const scenarioConfig: TurnWorldSnapshot['scenarioConfig'] = {
        stat: { total: 165, min: 15, max: 80, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 70 },
        iconPath: '.',
        map: { targetGeneralPool: 'SPoolUnderU100', centennialNpcDexTargetRatio: 0.4 },
        const: {
            maxLevel: 255,
            defaultSpecialDomestic: 'None',
            dexLimit: 1_000_000,
        },
        environment: { mapName: 'test', unitSet: 'default' },
    };
    return new InMemoryTurnWorld(
        state,
        {
            scenarioConfig,
            map: { id: 'test', name: 'test', cities: [] },
            generals,
            cities: [],
            nations: [],
            troops: [],
            diplomacy: [],
            events: [event],
            initialEvents: [],
        },
        { schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] } }
    );
};

describe('AdvanceCentennialAllStar monthly action', () => {
    it('advances a user target, unlocks its trait, persists aux, and emits one milestone pair', async () => {
        const initial = calculateCentennialUserInitialStats(target, rules);
        const world = buildWorld([
            buildGeneral({
                id: 1,
                npcState: 0,
                stats: {
                    leadership: initial.leadership,
                    strength: initial.strength,
                    intelligence: initial.intel,
                },
                meta: withTargetMeta(initial),
            }),
        ]);
        const environment = {
            year: 186,
            month: 1,
            startyear: 180,
            currentEventID: 1,
            turnTime: new Date('0186-01-01T00:00:00.000Z'),
        };

        await createAdvanceCentennialAllStarHandler({ getWorld: () => world })([], environment, event);

        const updated = world.getGeneralById(1)!;
        expect(updated.role.specialDomestic).toBe('che_event_무쌍');
        expect([updated.meta.dex1, updated.meta.dex2, updated.meta.dex3, updated.meta.dex4, updated.meta.dex5]).toEqual(
            [144_000, 128_000, 112_000, 96_000, 80_000]
        );
        expect(world.peekDirtyState().generals).toHaveLength(1);
        expect(world.peekDirtyState().logs).toEqual([
            expect.objectContaining({
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                generalId: 1,
                text: '<L>올스타 동조율</>이 <C>40%</>에 도달했습니다!',
                format: LogFormat.PLAIN,
            }),
            expect.objectContaining({
                scope: LogScope.GENERAL,
                category: LogCategory.HISTORY,
                generalId: 1,
                text: '<L>올스타 동조율 40% 달성</>',
                format: LogFormat.YEAR_MONTH,
            }),
        ]);
    });

    it('uses the Ref .9 stat progress and .4 dex target only for generated NPCs', async () => {
        const world = buildWorld([
            buildGeneral({
                id: 2,
                npcState: 3,
                stats: { leadership: 15, strength: 15, intelligence: 10 },
                meta: withTargetMeta(),
            }),
            buildGeneral({
                id: 3,
                npcState: 2,
                stats: { leadership: 50, strength: 50, intelligence: 50 },
            }),
            buildGeneral({
                id: 4,
                npcState: 6,
                stats: { leadership: 15, strength: 15, intelligence: 10 },
                meta: withTargetMeta(),
            }),
        ]);
        const environment = {
            year: 195,
            month: 1,
            startyear: 180,
            currentEventID: 1,
            turnTime: new Date('0195-01-01T00:00:00.000Z'),
        };

        await createAdvanceCentennialAllStarHandler({ getWorld: () => world })([], environment, event);

        const npc = world.getGeneralById(2)!;
        expect(npc.stats).toEqual({ leadership: 91, strength: 73, intelligence: 10 });
        expect([npc.meta.dex1, npc.meta.dex2, npc.meta.dex3, npc.meta.dex4, npc.meta.dex5]).toEqual([
            360_000, 320_000, 280_000, 240_000, 200_000,
        ]);
        expect(world.getGeneralById(3)?.stats).toEqual({ leadership: 50, strength: 50, intelligence: 50 });
        const nationNpc = world.getGeneralById(4)!;
        expect(nationNpc.stats).toEqual({ leadership: 100, strength: 80, intelligence: 10 });
        expect([
            nationNpc.meta.dex1,
            nationNpc.meta.dex2,
            nationNpc.meta.dex3,
            nationNpc.meta.dex4,
            nationNpc.meta.dex5,
        ]).toEqual([900_000, 800_000, 700_000, 600_000, 500_000]);
        expect(world.peekDirtyState().generals.map((entry) => entry.id)).toEqual([2, 4]);
    });
});
