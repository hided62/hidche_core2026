import { describe, expect, it } from 'vitest';
import { LogCategory, LogFormat, loadActionModuleBundle, type GeneralItemSlots } from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import {
    createLostUniqueItemHandler,
    createMergeInheritPointRankHandler,
} from '../src/turn/monthlyUniqueInheritAction.js';
import type { TurnEvent, TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const event: TurnEvent = {
    id: 1,
    targetCode: 'month',
    priority: 9_000,
    condition: true,
    action: [],
    meta: {},
};

const environment = {
    year: 210,
    month: 1,
    startyear: 180,
    currentEventID: 1,
    turnTime: new Date('0210-01-01T00:00:00.000Z'),
};

const buildGeneral = (options: {
    id: number;
    name: string;
    npcState: number;
    items?: Partial<GeneralItemSlots>;
    meta?: Record<string, unknown>;
    inheritancePoints?: Record<string, number>;
}): TurnGeneral => ({
    id: options.id,
    userId: `user-${options.id}`,
    name: options.name,
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 50, strength: 50, intelligence: 50 },
    experience: 0,
    dedication: 0,
    officerLevel: 1,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: {
            horse: options.items?.horse ?? null,
            weapon: options.items?.weapon ?? null,
            book: options.items?.book ?? null,
            item: options.items?.item ?? null,
        },
    },
    injury: 0,
    gold: 0,
    rice: 0,
    crew: 0,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 30,
    startAge: 20,
    npcState: options.npcState,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 1, ...(options.meta ?? {}) },
    inheritancePoints: options.inheritancePoints,
    lastTurn: { command: '휴식' },
    turnTime: new Date('0210-01-01T00:00:00.000Z'),
});

const buildWorld = (generals: TurnGeneral[], worldMeta: Record<string, unknown> = {}) => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 210,
        currentMonth: 1,
        tickSeconds: 600,
        lastTurnTime: environment.turnTime,
        meta: { hiddenSeed: 'monthly-unique-fixture', ...worldMeta },
    };
    const scenarioConfig: TurnWorldSnapshot['scenarioConfig'] = {
        stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 70 },
        iconPath: '.',
        map: {},
        const: {},
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

describe('monthly unique-item loss and inheritance rank merge', () => {
    it('drops only non-buyable items in legacy slot and general order and writes the summary', async () => {
        const modules = (await loadActionModuleBundle()).itemModules;
        const world = buildWorld([
            buildGeneral({
                id: 1,
                name: '갑',
                npcState: 0,
                items: {
                    horse: 'che_명마_12_옥란백용구',
                    weapon: 'che_무기_15_의천검',
                    book: 'che_서적_01_효경전',
                    item: 'che_저지_삼황내문',
                },
            }),
            buildGeneral({
                id: 2,
                name: '을',
                npcState: 1,
                items: {
                    horse: 'che_명마_12_사륜거',
                    weapon: 'che_무기_01_단도',
                    item: 'che_부적_태현청생부',
                },
            }),
            buildGeneral({
                id: 3,
                name: '제외',
                npcState: 2,
                items: { item: 'che_저지_삼황내문' },
            }),
        ]);

        await createLostUniqueItemHandler({ getWorld: () => world, itemModules: modules })([1], environment, event);

        expect(world.getGeneralById(1)?.role.items).toEqual({
            horse: null,
            weapon: null,
            book: 'che_서적_01_효경전',
            item: null,
        });
        expect(world.getGeneralById(2)?.role.items).toEqual({
            horse: null,
            weapon: 'che_무기_01_단도',
            book: null,
            item: null,
        });
        expect(world.getGeneralById(3)?.role.items.item).toBe('che_저지_삼황내문');
        expect(world.peekDirtyState().logs.map((log) => log.text)).toEqual([
            '<C>옥란백용구(+12)</>를 잃었습니다.',
            '<C>의천검(+15)</>을 잃었습니다.',
            '<C>삼황내문(저지)</>을 잃었습니다.',
            '<C>사륜거(+12)</>를 잃었습니다.',
            '<C>태현청생부(부적)</>를 잃었습니다.',
            '<R><b>【망실】</b></>불운하게도 <Y>갑</>이 한 번에 유니크 <C>3</>종을 잃었습니다! (총 <C>5</>개)',
        ]);
        expect(world.peekDirtyState().logs.at(-1)).toEqual(
            expect.objectContaining({ category: LogCategory.HISTORY, format: LogFormat.YEAR_MONTH })
        );
    });

    it('writes the no-loss history without consuming RNG for buyable items', async () => {
        const modules = (await loadActionModuleBundle()).itemModules;
        const world = buildWorld([
            buildGeneral({
                id: 1,
                name: '갑',
                npcState: 0,
                items: { horse: 'che_명마_05_갈색마', weapon: 'che_무기_01_단도' },
            }),
        ]);

        await createLostUniqueItemHandler({ getWorld: () => world, itemModules: modules })([1], environment, event);

        expect(world.peekDirtyState().generals).toEqual([]);
        expect(world.peekDirtyState().logs).toEqual([
            expect.objectContaining({
                text: '<R><b>【망실】</b></>어떤 아이템도 잃지 않았습니다!',
                category: LogCategory.HISTORY,
                format: LogFormat.YEAR_MONTH,
            }),
        ]);
    });

    it.skipIf(!process.env.REF_HIDDEN_SEED)('matches the isolated legacy 20% loss choices', async () => {
        const modules = (await loadActionModuleBundle()).itemModules;
        const world = buildWorld(
            [
                buildGeneral({
                    id: 1,
                    name: '갑',
                    npcState: 0,
                    items: {
                        horse: 'che_명마_12_옥란백용구',
                        weapon: 'che_무기_15_의천검',
                        book: 'che_서적_01_효경전',
                        item: 'che_저지_삼황내문',
                    },
                }),
                buildGeneral({
                    id: 2,
                    name: '을',
                    npcState: 1,
                    items: {
                        horse: 'che_명마_12_사륜거',
                        weapon: 'che_무기_01_단도',
                        item: 'che_부적_태현청생부',
                    },
                }),
            ],
            { hiddenSeed: process.env.REF_HIDDEN_SEED }
        );

        await createLostUniqueItemHandler({ getWorld: () => world, itemModules: modules })([0.2], environment, event);

        expect(world.getGeneralById(1)?.role.items).toEqual({
            horse: 'che_명마_12_옥란백용구',
            weapon: 'che_무기_15_의천검',
            book: 'che_서적_01_효경전',
            item: 'che_저지_삼황내문',
        });
        expect(world.getGeneralById(2)?.role.items).toEqual({
            horse: null,
            weapon: 'che_무기_01_단도',
            book: null,
            item: 'che_부적_태현청생부',
        });
        expect(world.peekDirtyState().logs.map((log) => log.text)).toEqual([
            '<C>사륜거(+12)</>를 잃었습니다.',
            '<R><b>【망실】</b></>불운하게도 <Y>을</>이 한 번에 유니크 <C>1</>종을 잃었습니다! (총 <C>1</>개)',
        ]);
    });

    it('merges every active inheritance source except previous into rank values', async () => {
        const world = buildWorld([
            buildGeneral({
                id: 1,
                name: '갑',
                npcState: 0,
                meta: {
                    belong: 3,
                    inherit_lived_month: 2,
                    max_domestic_critical: 4,
                    inherit_active_action: 5,
                    dex1: 1000,
                    dex2: 0,
                    dex3: 0,
                    dex4: 0,
                    dex5: 0,
                    rank_warnum: 2,
                    firenum: 1,
                    betwin: 2,
                    betgold: 4000,
                    betwingold: 2000,
                    inherit_earned_act: 11,
                    inherit_spent_dyn: 9,
                },
                inheritancePoints: {
                    previous: 999,
                    unifier: 6,
                    tournament: 7,
                },
            }),
        ]);

        await createMergeInheritPointRankHandler({ getWorld: () => world })([], environment, event);

        expect(world.getGeneralById(1)?.meta).toEqual(
            expect.objectContaining({
                inherit_earned_dyn: 100,
                inherit_earned: 111,
                inherit_spent: 9,
            })
        );
    });

    it('uses persisted per-key values after unification', async () => {
        const stored = Object.fromEntries(
            [
                'lived_month',
                'max_domestic_critical',
                'active_action',
                'unifier',
                'tournament',
                'max_belong',
                'combat',
                'sabotage',
                'dex',
                'betting',
            ].map((key, index) => [key, index + 1])
        );
        const world = buildWorld(
            [
                buildGeneral({
                    id: 1,
                    name: '갑',
                    npcState: 0,
                    meta: { inherit_earned_act: 5, inherit_spent_dyn: 3 },
                    inheritancePoints: { previous: 999, ...stored },
                }),
            ],
            { isunited: 1 }
        );

        await createMergeInheritPointRankHandler({ getWorld: () => world })([], environment, event);

        expect(world.getGeneralById(1)?.meta).toEqual(
            expect.objectContaining({
                inherit_earned_dyn: 55,
                inherit_earned: 60,
                inherit_spent: 3,
            })
        );
    });
});
