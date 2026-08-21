import { describe, expect, it } from 'vitest';

import type { RandomGenerator } from '@sammo-ts/common';

import type { General, Nation } from '../src/domain/entities.js';
import type { TurnCommandEnv, TurnCommandItemCatalogEntry } from '../src/actions/turn/commandEnv.js';
import { ActionDefinition as TradeItemAction } from '../src/actions/turn/general/che_장비매매.js';
import { consumeSuccessfulStrategyItem } from '../src/actions/turn/general/strategyItemConsumption.js';
import { GeneralActionPipeline } from '../src/actionModules/general.js';
import { createRefOrderedActionStack } from '../src/actionModules/bundle.js';
import { createItemActionModules, createItemModuleRegistry } from '../src/items/index.js';
import { getEquippedItemInstance } from '../src/items/inventory.js';
import { itemModule as dogiModule } from '../src/items/che_보물_도기.js';
import { itemModule as strategyItemModule } from '../src/items/che_계략_이추.js';
import { LogFormat } from '../src/logging/types.js';

const BASE_ENV: TurnCommandEnv = {
    develCost: 100,
    trainDelta: 35,
    atmosDelta: 35,
    maxTrainByCommand: 100,
    maxAtmosByCommand: 100,
    sabotageDefaultProb: 0.5,
    sabotageProbCoefByStat: 0.1,
    sabotageDefenceCoefByGeneralCount: 0.1,
    sabotageDamageMin: 10,
    sabotageDamageMax: 30,
    openingPartYear: 200,
    maxGeneral: 10,
    defaultNpcGold: 1000,
    defaultNpcRice: 1000,
    defaultCrewTypeId: 1,
    defaultSpecialDomestic: null,
    defaultSpecialWar: null,
    initialNationGenLimit: 10,
    maxTechLevel: 10,
    baseGold: 1000,
    baseRice: 1000,
    maxResourceActionAmount: 10000,
};

const makeGeneral = (itemKey: string | null): General => ({
    id: 1,
    name: '도기 장수',
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 70, strength: 70, intelligence: 70 },
    experience: 0,
    dedication: 0,
    officerLevel: 1,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: itemKey },
    },
    injury: 0,
    gold: 1000,
    rice: 1000,
    crew: 1000,
    crewTypeId: 1100,
    train: 100,
    atmos: 100,
    age: 30,
    npcState: 0,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24 },
});

const makeNation = (): Nation => ({
    id: 1,
    name: '도기국',
    color: '#000000',
    capitalCityId: 1,
    chiefGeneralId: 1,
    gold: 500,
    rice: 500,
    power: 0,
    level: 1,
    typeCode: 'None',
    meta: {},
});

const makeChoiceRng = (index: 0 | 1): { rng: RandomGenerator; calls: Array<[number, number]> } => {
    const calls: Array<[number, number]> = [];
    return {
        calls,
        rng: {
            nextFloat1: () => index,
            nextBool: () => index === 1,
            nextInt: (minInclusive, maxExclusive) => {
                calls.push([minInclusive, maxExclusive]);
                return index;
            },
        },
    };
};

const dogiCatalog: Record<string, TurnCommandItemCatalogEntry> = {
    che_보물_도기: {
        slot: 'item',
        name: '도기(보물)',
        rawName: '도기',
        cost: 200,
        reqSecu: 0,
        buyable: false,
        unique: true,
    },
};

const createItemOnlyStack = (items: ReturnType<typeof createItemActionModules>['general']) => {
    const noOp = {};
    return createRefOrderedActionStack({
        nation: noOp,
        officer: noOp,
        domestic: noOp,
        war: noOp,
        personality: noOp,
        crewType: null,
        inheritance: noOp,
        scenario: null,
        items,
    });
};

describe('typed item lifecycle events', () => {
    it.each([
        {
            name: 'bit 0은 ref choice index 0인 금을 선택한다',
            bit: 0 as const,
            year: 200,
            expectedGeneral: { gold: 6100, rice: 1000 },
            expectedNation: { gold: 5500, rice: 500 },
            resource: '금',
        },
        {
            name: 'bit 1은 ref choice index 1인 쌀을 선택한다',
            bit: 1 as const,
            year: 200,
            expectedGeneral: { gold: 1100, rice: 6000 },
            expectedNation: { gold: 500, rice: 5500 },
            resource: '쌀',
        },
        {
            name: '2년 경계에서 보충량이 15,000으로 증가한다',
            bit: 0 as const,
            year: 202,
            expectedGeneral: { gold: 8600, rice: 1000 },
            expectedNation: { gold: 8000, rice: 500 },
            resource: '금',
        },
    ])('$name', ({ bit, year, expectedGeneral, expectedNation, resource }) => {
        const general = makeGeneral('che_보물_도기');
        const nation = makeNation();
        const logs: Array<{ message: string; format: LogFormat | undefined }> = [];
        let stateAtSaleLog: { gold: number; equipped: string | null } | null = null;
        const { rng, calls } = makeChoiceRng(bit);
        const itemModules = createItemActionModules(createItemModuleRegistry([dogiModule]));
        const action = new TradeItemAction({
            ...BASE_ENV,
            itemCatalog: dogiCatalog,
            generalActionModules: createItemOnlyStack(itemModules.general),
        });

        const outcome = action.resolve(
            {
                general,
                nation,
                rng,
                time: { year, month: 1, startYear: 200 },
                addLog: (message, options) => {
                    if (logs.length === 0) {
                        stateAtSaleLog = {
                            gold: general.gold,
                            equipped: general.role.items.item,
                        };
                    }
                    logs.push({ message, format: options?.format });
                },
            },
            { itemType: 'item', itemCode: 'None' }
        );

        expect({ gold: general.gold, rice: general.rice }).toEqual(expectedGeneral);
        expect({ gold: nation.gold, rice: nation.rice }).toEqual(expectedNation);
        expect(general.role.items.item).toBeNull();
        expect(calls).toEqual([[0, 2]]);
        expect(stateAtSaleLog).toEqual({ gold: 1000, equipped: 'che_보물_도기' });
        expect(logs.slice(0, 2)).toEqual([
            {
                message: '<C>도기(보물)</>를 판매했습니다.',
                format: LogFormat.MONTH,
            },
            {
                message: `재산과 국고에 총 ${resource} <C>${year === 202 ? '15,000' : '10,000'}</>을 보충합니다.`,
                format: LogFormat.MONTH,
            },
        ]);
        expect(outcome.effects).toContainEqual(
            expect.objectContaining({
                type: 'general:patch',
                patch: expect.objectContaining(expectedGeneral),
            })
        );
        expect(outcome.effects).toContainEqual(
            expect.objectContaining({
                type: 'nation:patch',
                targetId: nation.id,
                patch: expect.objectContaining(expectedNation),
            })
        );
    });

    it.each([
        ['che_치료_환약', 3],
        ['event_충차', 2],
    ])('%s 구매 시 charge를 canonical inventory에 초기화한다', (itemKey, charges) => {
        const catalog: Record<string, TurnCommandItemCatalogEntry> = {
            [itemKey]: {
                slot: 'item',
                name: itemKey,
                rawName: itemKey,
                cost: 100,
                reqSecu: 0,
                buyable: true,
                unique: false,
                initialCharges: charges,
            },
        };
        const general = makeGeneral(null);
        const action = new TradeItemAction({
            ...BASE_ENV,
            itemCatalog: catalog,
        });
        const { rng } = makeChoiceRng(0);

        action.resolve(
            {
                general,
                nation: makeNation(),
                rng,
                time: { year: 200, month: 1, startYear: 200 },
                addLog: () => {},
            },
            { itemType: 'item', itemCode: itemKey }
        );

        expect(getEquippedItemInstance(general, 'item')).toMatchObject({
            itemKey,
            state: { charges },
        });
    });

    it('시나리오 상점 목록에 없는 전역 구매 가능 아이템을 거부한다', () => {
        const itemKey = 'event_전투특기_격노';
        const catalog: Record<string, TurnCommandItemCatalogEntry> = {
            [itemKey]: {
                slot: 'item',
                name: '격노의 비급',
                rawName: '격노의 비급',
                cost: 100,
                reqSecu: 0,
                buyable: true,
                unique: false,
            },
        };
        const denied = new TradeItemAction({
            ...BASE_ENV,
            itemCatalog: catalog,
            purchasableItemKeys: new Set(),
        });
        const allowed = new TradeItemAction({
            ...BASE_ENV,
            itemCatalog: catalog,
            purchasableItemKeys: new Set([itemKey]),
        });

        expect(denied.parseArgs({ itemType: 'item', itemCode: itemKey })).toBeNull();
        expect(allowed.parseArgs({ itemType: 'item', itemCode: itemKey })).toEqual({
            itemType: 'item',
            itemCode: itemKey,
        });
    });

    it('계략 성공 capability만 소비하며 typed 결과로 소비 item을 반환한다', () => {
        const general = makeGeneral('che_계략_이추');
        const itemModules = createItemActionModules(createItemModuleRegistry([strategyItemModule]));
        const pipeline = new GeneralActionPipeline(itemModules.general);
        const { rng } = makeChoiceRng(0);

        const consumedItems = consumeSuccessfulStrategyItem(pipeline, {
            general,
            nation: makeNation(),
            rng,
            addLog: () => {},
        });

        expect(consumedItems).toEqual(['che_계략_이추']);
        expect(general.role.items.item).toBeNull();
    });
});
