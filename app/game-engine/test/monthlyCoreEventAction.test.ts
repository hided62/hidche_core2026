import { describe, expect, it } from 'vitest';
import { LogCategory, LogFormat, LogScope, type City, type MapDefinition, type Nation } from '@sammo-ts/logic';

import { createIncomeHandler, resolveLegacyIncomeCityTrust } from '../src/turn/incomeHandler.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { calculateNpcNationFinance } from '../src/turn/npcTaxHandler.js';
import {
    createNewYearHandler,
    createNoticeToHistoryLogHandler,
    createProcessIncomeActionHandler,
    createResetOfficerLockHandler,
} from '../src/turn/monthlyCoreEventAction.js';
import { createMonthlyEventHandler, type MonthlyEventActionHandler } from '../src/turn/monthlyEventHandler.js';
import { buildCommandEnv } from '../src/turn/reservedTurnCommands.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const map: MapDefinition = {
    id: 'core-event-test',
    name: 'core-event-test',
    cities: [],
    defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
};

const buildNation = (): Nation => ({
    id: 1,
    name: '갑국',
    color: '#777777',
    capitalCityId: 1,
    chiefGeneralId: 1,
    gold: 10_000,
    rice: 20_000,
    power: 0,
    level: 1,
    typeCode: 'che_중립',
    meta: { rate: 20, bill: 0, chief_set: 1 },
});

const buildCity = (): City => ({
    id: 1,
    name: '갑성',
    nationId: 1,
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
    defence: 500,
    defenceMax: 1_000,
    wall: 500,
    wallMax: 1_000,
    conflict: {},
    meta: { trust: 80, trade: 100, officer_set: 1 },
});

const buildGeneral = (id: number, nationId: number, belong: number): TurnGeneral => ({
    id,
    name: `장수${id}`,
    nationId,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 50, strength: 50, intelligence: 50 },
    experience: 0,
    dedication: 100,
    officerLevel: 5,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: 1_000,
    rice: 1_000,
    crew: 100,
    crewTypeId: 1100,
    train: 50,
    atmos: 50,
    age: 30,
    npcState: 0,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24, belong },
    turnTime: new Date('0190-06-01T00:00:00.000Z'),
});

const buildWorld = (
    events: TurnWorldSnapshot['events'],
    registerActions: (world: () => InMemoryTurnWorld | null) => Map<string, MonthlyEventActionHandler>,
    options: {
        currentMonth: number;
        generals?: TurnGeneral[];
        nations?: Nation[];
        cities?: City[];
    }
): InMemoryTurnWorld => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 190,
        currentMonth: options.currentMonth,
        tickSeconds: 600,
        lastTurnTime: new Date(`0190-${String(options.currentMonth).padStart(2, '0')}-01T00:00:00.000Z`),
        meta: { hiddenSeed: 'monthly-core-actions' },
    };
    const snapshot: TurnWorldSnapshot = {
        scenarioConfig: {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
            iconPath: '',
            map: {},
            const: { baseGold: 0, baseRice: 0 },
            environment: { mapName: map.id, unitSet: 'default' },
        },
        scenarioMeta: {
            title: 'core event test',
            startYear: 190,
            life: null,
            fiction: null,
            history: [],
            ignoreDefaultEvents: false,
        },
        map,
        diplomacy: [],
        events,
        initialEvents: [],
        generals: options.generals ?? [],
        cities: options.cities ?? [],
        nations: options.nations ?? [],
        troops: [],
    };
    let world: InMemoryTurnWorld | null = null;
    const actions = registerActions(() => world);
    world = new InMemoryTurnWorld(state, snapshot, {
        schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
        calendarHandler: createMonthlyEventHandler({
            getWorld: () => world,
            startYear: 190,
            actions,
        }),
    });
    return world;
};

describe('core monthly event actions at the real month boundary', () => {
    it('reads income trust through the PHP six-significant-digit FLOAT representation', () => {
        expect(resolveLegacyIncomeCityTrust(98.12674)).toBe(98.1267);
    });

    it('preserves notice format, NewYear month log, age/belong, and officer lock reset', async () => {
        const world = buildWorld(
            [
                {
                    id: 1,
                    targetCode: 'month',
                    priority: 1,
                    condition: true,
                    action: [
                        ['NoticeToHistoryLog', '<S>새해 알림</>', LogFormat.EVENT_YEAR_MONTH],
                        ['NewYear'],
                        ['ResetOfficerLock'],
                    ],
                    meta: {},
                },
            ],
            (getWorld) =>
                new Map([
                    ['NoticeToHistoryLog', createNoticeToHistoryLogHandler({ getWorld })],
                    ['NewYear', createNewYearHandler({ getWorld })],
                    ['ResetOfficerLock', createResetOfficerLockHandler({ getWorld })],
                ]),
            {
                currentMonth: 12,
                generals: [buildGeneral(1, 1, 3), buildGeneral(2, 0, 4)],
                nations: [buildNation()],
                cities: [buildCity()],
            }
        );

        await world.advanceMonth(new Date('0191-01-01T00:00:00.000Z'));

        expect(world.getGeneralById(1)).toMatchObject({ age: 31, meta: { belong: 4 } });
        expect(world.getGeneralById(2)).toMatchObject({ age: 31, meta: { belong: 4 } });
        expect(world.getNationById(1)?.meta.chief_set).toBe(0);
        expect(world.getCityById(1)?.meta.officer_set).toBe(0);
        expect(world.peekDirtyState().logs).toEqual([
            {
                scope: LogScope.SYSTEM,
                category: LogCategory.HISTORY,
                text: '<S>새해 알림</>',
                format: LogFormat.EVENT_YEAR_MONTH,
                year: 191,
                month: 1,
            },
            {
                scope: LogScope.SYSTEM,
                category: LogCategory.ACTION,
                text: '<C>191</>년이 되었습니다.',
                format: LogFormat.MONTH,
            },
        ]);
    });

    it('uses the ProcessIncome resource argument and keeps MoreEffect income dormant like ref', async () => {
        const world = buildWorld(
            [
                {
                    id: 2,
                    targetCode: 'month',
                    priority: 1,
                    condition: true,
                    action: [['ProcessIncome', 'gold']],
                    meta: {},
                },
            ],
            (getWorld) => {
                const incomeHandler = createIncomeHandler({
                    getWorld,
                    scenarioConfig: {
                        stat: {
                            total: 300,
                            min: 10,
                            max: 100,
                            npcTotal: 150,
                            npcMax: 50,
                            npcMin: 10,
                            chiefMin: 70,
                        },
                        iconPath: '',
                        map: {},
                        const: { baseGold: 0, baseRice: 0 },
                        environment: {
                            mapName: map.id,
                            unitSet: 'default',
                            scenarioEffect: 'event_MoreEffect',
                        },
                    },
                    nationTraits: new Map(),
                });
                return new Map([['ProcessIncome', createProcessIncomeActionHandler(incomeHandler)]]);
            },
            {
                currentMonth: 6,
                generals: [buildGeneral(1, 1, 3)],
                nations: [buildNation()],
                cities: [buildCity()],
            }
        );

        await world.advanceMonth(new Date('0190-07-01T00:00:00.000Z'));

        expect(world.getNationById(1)).toMatchObject({
            gold: 10_210,
            rice: 20_000,
            meta: {
                prev_income_gold: 210,
            },
        });
        expect(world.getGeneralById(1)).toMatchObject({ gold: 1_000, rice: 1_000 });
        expect(world.getNationById(1)?.meta.prev_income_rice).toBeUndefined();
        expect(world.peekDirtyState().logs).toContainEqual(
            expect.objectContaining({
                category: LogCategory.HISTORY,
                text: '<W><b>【지급】</b></>봄이 되어 봉록에 따라 자금이 지급됩니다.',
            })
        );
    });

    it('uses the staged rate_tmp for income when the desired rate changes mid-period', async () => {
        const nation = buildNation();
        nation.meta = { ...nation.meta, rate: 35, rate_tmp: 10 };
        const world = buildWorld(
            [
                {
                    id: 3,
                    targetCode: 'month',
                    priority: 1,
                    condition: true,
                    action: [['ProcessIncome', 'gold']],
                    meta: {},
                },
            ],
            (getWorld) => {
                const incomeHandler = createIncomeHandler({
                    getWorld,
                    scenarioConfig: {
                        stat: {
                            total: 300,
                            min: 10,
                            max: 100,
                            npcTotal: 150,
                            npcMax: 50,
                            npcMin: 10,
                            chiefMin: 70,
                        },
                        iconPath: '',
                        map: {},
                        const: { baseGold: 0, baseRice: 0 },
                        environment: { mapName: map.id, unitSet: 'default' },
                    },
                    nationTraits: new Map(),
                });
                return new Map([['ProcessIncome', createProcessIncomeActionHandler(incomeHandler)]]);
            },
            {
                currentMonth: 6,
                generals: [buildGeneral(1, 1, 3)],
                nations: [nation],
                cities: [buildCity()],
            }
        );

        await world.advanceMonth(new Date('0190-07-01T00:00:00.000Z'));

        expect(world.getNationById(1)).toMatchObject({
            gold: 10_105,
            meta: {
                rate: 35,
                rate_tmp: 10,
                prev_income_gold: 105,
            },
        });
    });

    it('keeps fractional income for the legacy salary payout ratio', async () => {
        const nation = buildNation();
        nation.gold = 0;
        nation.meta = { ...nation.meta, rate: 15, rate_tmp: 15, bill: 100 };
        const world = buildWorld(
            [
                {
                    id: 4,
                    targetCode: 'month',
                    priority: 1,
                    condition: true,
                    action: [['ProcessIncome', 'gold']],
                    meta: {},
                },
            ],
            (getWorld) => {
                const incomeHandler = createIncomeHandler({
                    getWorld,
                    scenarioConfig: {
                        stat: {
                            total: 300,
                            min: 10,
                            max: 100,
                            npcTotal: 150,
                            npcMax: 50,
                            npcMin: 10,
                            chiefMin: 70,
                        },
                        iconPath: '',
                        map: {},
                        const: { baseGold: 0, baseRice: 0 },
                        environment: { mapName: map.id, unitSet: 'default' },
                    },
                    nationTraits: new Map(),
                });
                return new Map([['ProcessIncome', createProcessIncomeActionHandler(incomeHandler)]]);
            },
            {
                currentMonth: 12,
                generals: [buildGeneral(1, 1, 3)],
                nations: [nation],
                cities: [buildCity()],
            }
        );

        await world.advanceMonth(new Date('0191-01-01T00:00:00.000Z'));

        expect(world.getNationById(1)?.meta.prev_income_gold).toBe(157.5);
        expect(world.peekDirtyState().logs).toContainEqual(
            expect.objectContaining({
                generalId: 1,
                text: '이번 수입은 금 <C>158</>입니다.',
            })
        );
        expect(world.peekDirtyState().logs.map((entry) => entry.text).join('\n')).not.toContain('157.5');
    });

    it('uses the Ref default nation resource floors when scenario const omits them', async () => {
        const nation = buildNation();
        nation.rice = 0;
        const general = buildGeneral(1, 1, 3);
        const world = buildWorld(
            [
                {
                    id: 5,
                    targetCode: 'month',
                    priority: 1,
                    condition: true,
                    action: [['ProcessIncome', 'rice']],
                    meta: {},
                },
            ],
            (getWorld) => {
                const incomeHandler = createIncomeHandler({
                    getWorld,
                    scenarioConfig: {
                        stat: {
                            total: 300,
                            min: 10,
                            max: 100,
                            npcTotal: 150,
                            npcMax: 50,
                            npcMin: 10,
                            chiefMin: 70,
                        },
                        iconPath: '',
                        map: {},
                        const: {},
                        environment: { mapName: map.id, unitSet: 'default' },
                    },
                    nationTraits: new Map(),
                });
                return new Map([['ProcessIncome', createProcessIncomeActionHandler(incomeHandler)]]);
            },
            {
                currentMonth: 6,
                generals: [general],
                nations: [nation],
                cities: [buildCity()],
            }
        );

        await world.advanceMonth(new Date('0190-07-01T00:00:00.000Z'));

        expect(world.getNationById(1)?.rice).toBe(2_000);
        expect(world.getGeneralById(1)?.rice).toBe(general.rice);
    });

    it('excludes the NPC ruler stipend when choosing the nation bill like Ref', () => {
        const config: TurnWorldSnapshot['scenarioConfig'] = {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
            iconPath: '',
            map: {},
            const: { baseGold: 0, baseRice: 0 },
            environment: { mapName: map.id, unitSet: 'default' },
        };
        const buildFinanceWorld = (chiefDedication: number) => {
            const chief = buildGeneral(1, 1, 3);
            chief.npcState = 2;
            chief.officerLevel = 12;
            chief.dedication = chiefDedication;
            const subordinate = buildGeneral(2, 1, 3);
            subordinate.npcState = 2;
            return buildWorld([], () => new Map(), {
                currentMonth: 12,
                generals: [chief, subordinate],
                nations: [buildNation()],
                cities: [buildCity()],
            });
        };
        const options = { scenarioConfig: config, commandEnv: buildCommandEnv(config) };
        const lowChiefWorld = buildFinanceWorld(1);
        const highChiefWorld = buildFinanceWorld(100_000);

        const lowChiefBill = calculateNpcNationFinance(
            lowChiefWorld,
            lowChiefWorld.getNationById(1)!,
            12,
            options
        )?.bill;
        const highChiefBill = calculateNpcNationFinance(
            highChiefWorld,
            highChiefWorld.getNationById(1)!,
            12,
            options
        )?.bill;

        expect(lowChiefBill).toBeTypeOf('number');
        expect(highChiefBill).toBe(lowChiefBill);
    });

    it('keeps user-ruler finance unchanged by default and applies it only after opt-in', () => {
        const config: TurnWorldSnapshot['scenarioConfig'] = {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
            iconPath: '',
            map: {},
            const: { baseGold: 0, baseRice: 0 },
            environment: { mapName: map.id, unitSet: 'default' },
        };
        const buildFinanceWorld = (settings: {
            finance: number;
            autorunLimit?: number;
            nationTurn?: number;
        }) => {
            const chief = buildGeneral(1, 1, 3);
            chief.npcState = 0;
            chief.officerLevel = 12;
            chief.meta = {
                ...chief.meta,
                use_auto_nation_finance: settings.finance,
                ...(settings.autorunLimit === undefined ? {} : { autorun_limit: settings.autorunLimit }),
                ...(settings.nationTurn === undefined ? {} : { use_auto_nation_turn: settings.nationTurn }),
            };
            const subordinate = buildGeneral(2, 1, 3);
            return buildWorld([], () => new Map(), {
                currentMonth: 12,
                generals: [chief, subordinate],
                nations: [buildNation()],
                cities: [buildCity()],
            });
        };
        const options = { scenarioConfig: config, commandEnv: buildCommandEnv(config) };
        const disabled = buildFinanceWorld({ finance: 0, autorunLimit: 19101 });
        const outsideAutorun = buildFinanceWorld({ finance: 1 });
        const masterDisabled = buildFinanceWorld({ finance: 1, autorunLimit: 19101, nationTurn: 0 });
        const enabled = buildFinanceWorld({ finance: 1, autorunLimit: 19101, nationTurn: 1 });

        expect(calculateNpcNationFinance(disabled, disabled.getNationById(1)!, 12, options)).toBeNull();
        expect(
            calculateNpcNationFinance(outsideAutorun, outsideAutorun.getNationById(1)!, 12, options)
        ).toBeNull();
        expect(
            calculateNpcNationFinance(masterDisabled, masterDisabled.getNationById(1)!, 12, options)
        ).toBeNull();
        expect(calculateNpcNationFinance(enabled, enabled.getNationById(1)!, 12, options)).toEqual(
            expect.objectContaining({ rate: expect.any(Number), bill: expect.any(Number) })
        );
    });
});
