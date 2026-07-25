import { describe, expect, it } from 'vitest';
import { LogCategory, LogFormat } from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import {
    createAddGlobalBetrayHandler,
    createAssignGeneralSpecialityHandler,
} from '../src/turn/monthlySpecialityBetrayAction.js';
import type { TurnEvent, TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const event: TurnEvent = {
    id: 1,
    targetCode: 'month',
    priority: 9_000,
    condition: true,
    action: [],
    meta: {},
};

const buildGeneral = (options: {
    id: number;
    name: string;
    nationId: number;
    stats: [number, number, number];
    specialDomestic: string | null;
    specialWar: string | null;
    meta: Record<string, unknown>;
}): TurnGeneral => ({
    id: options.id,
    userId: null,
    name: options.name,
    nationId: options.nationId,
    cityId: options.id === 1 ? 1 : 2,
    troopId: 0,
    stats: {
        leadership: options.stats[0],
        strength: options.stats[1],
        intelligence: options.stats[2],
    },
    experience: 0,
    dedication: 0,
    officerLevel: 1,
    role: {
        personality: null,
        specialDomestic: options.specialDomestic,
        specialWar: options.specialWar,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: 1_000,
    rice: 1_000,
    crew: 0,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 30,
    startAge: 20,
    npcState: 2,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { ...options.meta, killturn: 24 },
    lastTurn: { command: '휴식' },
    turnTime: new Date('0200-01-01T00:00:00.000Z'),
});

const buildWorld = (hiddenSeed = 'monthly-speciality-fixture') => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 200,
        currentMonth: 1,
        tickSeconds: 600,
        lastTurnTime: new Date('0200-01-01T00:00:00.000Z'),
        meta: { hiddenSeed },
    };
    const scenarioConfig: TurnWorldSnapshot['scenarioConfig'] = {
        stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 70 },
        iconPath: '.',
        map: {},
        const: {
            defaultSpecialDomestic: 'None',
            defaultSpecialWar: 'None',
            retirementYear: 80,
        },
        environment: { mapName: 'test', unitSet: 'default' },
    };
    const domesticGeneral = buildGeneral({
            id: 1,
            name: '내정대상',
            nationId: 1,
            stats: [40, 45, 80],
            specialDomestic: null,
            specialWar: 'che_신산',
            meta: { specage: 30, specage2: 99, prev_types_special: ['che_경작'] },
        });
    const warGeneral = buildGeneral({
            id: 2,
            name: '전투대상',
            nationId: 1,
            stats: [80, 75, 40],
            specialDomestic: 'che_인덕',
            specialWar: null,
            meta: {
                specage: 99,
                specage2: 30,
                prev_types_special2: ['che_돌격'],
                dex1: 200,
                dex2: 10,
                dex3: 10,
                dex4: 10,
                dex5: 10,
            },
        });
    const inheritedGeneral = buildGeneral({
            id: 3,
            name: '계승대상',
            nationId: 2,
            stats: [50, 50, 50],
            specialDomestic: 'che_경작',
            specialWar: null,
            meta: { specage: 99, specage2: 30, inheritSpecificSpecialWar: 'che_의술', marker: 3 },
        });
    // The isolated Aria fixture scans eligible war rows as 3, 2 because the
    // legacy query has no ORDER BY. Preserve that input order in this trace.
    const generals = [domesticGeneral, inheritedGeneral, warGeneral];
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

const environment = {
    year: 200,
    month: 1,
    startyear: 190,
    currentEventID: 1,
    turnTime: new Date('0200-01-01T00:00:00.000Z'),
};

describe('monthly speciality and betrayal actions', () => {
    it('assigns eligible traits, consumes inherited war choice without RNG, and writes legacy logs', async () => {
        const world = buildWorld();
        await createAssignGeneralSpecialityHandler({ getWorld: () => world })([], environment, event);

        expect(world.getGeneralById(1)?.role.specialDomestic).not.toBeNull();
        expect(world.getGeneralById(1)?.role.specialDomestic).not.toBe('che_경작');
        expect(world.getGeneralById(2)?.role.specialWar).not.toBeNull();
        expect(world.getGeneralById(2)?.role.specialWar).not.toBe('che_돌격');
        expect(world.getGeneralById(3)?.role.specialWar).toBe('che_의술');
        expect(world.getGeneralById(3)?.meta).toEqual(expect.objectContaining({ marker: 3, killturn: 24 }));
        expect(world.getGeneralById(3)?.meta).not.toHaveProperty('inheritSpecificSpecialWar');

        const logs = world.peekDirtyState().logs;
        expect(logs).toHaveLength(6);
        expect(logs.slice(2, 4)).toEqual([
            expect.objectContaining({
                generalId: 3,
                category: LogCategory.HISTORY,
                format: LogFormat.YEAR_MONTH,
                text: '특기 【<b><C>의술</></b>】을 습득',
            }),
            expect.objectContaining({
                generalId: 3,
                category: LogCategory.ACTION,
                format: LogFormat.PLAIN,
                text: '특기 【<b><L>의술</></b>】을 익혔습니다!',
            }),
        ]);
    });

    it('does nothing before the three-year opening period ends', async () => {
        const world = buildWorld();
        await createAssignGeneralSpecialityHandler({ getWorld: () => world })(
            [],
            { ...environment, year: 192 },
            event
        );
        expect(world.peekDirtyState().generals).toEqual([]);
        expect(world.peekDirtyState().logs).toEqual([]);
    });

    it('preserves a domestic trait when the same general also receives a war trait', async () => {
        const world = buildWorld();
        const general = world.getGeneralById(1)!;
        world.updateGeneral(1, {
            role: { ...general.role, specialWar: null },
            meta: { ...general.meta, specage2: 30 },
        });
        world.acknowledgeDirtyState(world.peekDirtyState());

        await createAssignGeneralSpecialityHandler({ getWorld: () => world })([], environment, event);

        expect(world.getGeneralById(1)?.role.specialDomestic).not.toBeNull();
        expect(world.getGeneralById(1)?.role.specialWar).not.toBeNull();
    });

    it('applies the two default scenario betrayal steps only to values within each threshold', async () => {
        const world = buildWorld();
        world.updateGeneral(1, { meta: { ...world.getGeneralById(1)!.meta, betray: 0 } });
        world.updateGeneral(2, { meta: { ...world.getGeneralById(2)!.meta, betray: 1 } });
        world.updateGeneral(3, { meta: { ...world.getGeneralById(3)!.meta, betray: 2 } });
        world.acknowledgeDirtyState(world.peekDirtyState());
        const handler = createAddGlobalBetrayHandler({ getWorld: () => world });

        await handler([1, 0], environment, event);
        await handler([1, 1], environment, event);

        expect(world.listGenerals().map((general) => general.meta.betray)).toEqual([2, 2, 2]);
    });

    it.skipIf(!process.env.REF_HIDDEN_SEED)('matches the isolated legacy fixed-seed trait choices', async () => {
        const world = buildWorld(process.env.REF_HIDDEN_SEED);
        await createAssignGeneralSpecialityHandler({ getWorld: () => world })([], environment, event);

        expect(world.getGeneralById(1)?.role.specialDomestic).toBe('che_상재');
        expect(world.getGeneralById(2)?.role.specialWar).toBe('che_필살');
        expect(world.getGeneralById(3)?.role.specialWar).toBe('che_의술');
        expect(
            world.peekDirtyState().logs.map((log) => ({
                generalId: log.generalId,
                category: log.category,
                text: log.text,
                format: log.format,
            }))
        ).toEqual([
            {
                generalId: 1,
                category: LogCategory.HISTORY,
                text: '특기 【<b><C>상재</></b>】를 습득',
                format: LogFormat.YEAR_MONTH,
            },
            {
                generalId: 1,
                category: LogCategory.ACTION,
                text: '특기 【<b><L>상재</></b>】를 익혔습니다!',
                format: LogFormat.PLAIN,
            },
            {
                generalId: 3,
                category: LogCategory.HISTORY,
                text: '특기 【<b><C>의술</></b>】을 습득',
                format: LogFormat.YEAR_MONTH,
            },
            {
                generalId: 3,
                category: LogCategory.ACTION,
                text: '특기 【<b><L>의술</></b>】을 익혔습니다!',
                format: LogFormat.PLAIN,
            },
            {
                generalId: 2,
                category: LogCategory.HISTORY,
                text: '특기 【<b><C>필살</></b>】을 습득',
                format: LogFormat.YEAR_MONTH,
            },
            {
                generalId: 2,
                category: LogCategory.ACTION,
                text: '특기 【<b><L>필살</></b>】을 익혔습니다!',
                format: LogFormat.PLAIN,
            },
        ]);
    });
});
