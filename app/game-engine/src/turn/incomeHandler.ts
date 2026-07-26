import { asNumber, asRecord } from '@sammo-ts/common';
import {
    ActionLogger,
    LogFormat,
    createIncomeActionContext,
    getBill,
    getGoldIncome,
    getOutcome,
    getRiceIncome,
    getWallIncome,
    type CityIncomeSource,
    type Nation,
    type NationIncomeContext,
    type NationTraitModule,
    type TriggerNationalIncomeType,
} from '@sammo-ts/logic';

import type { ScenarioConfig } from '@sammo-ts/logic';

import type { InMemoryTurnWorld, TurnCalendarHandler, TurnCalendarContext } from './inMemoryWorld.js';
import type { TurnGeneral } from './types.js';

const resolveNumber = (source: Record<string, unknown>, keys: string[], fallback: number): number => {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
    }
    return fallback;
};

const resolveNationRate = (nation: Nation): number => asNumber(nation.meta.rate, 20);

const resolveNationBill = (nation: Nation): number => asNumber(nation.meta.bill, 100);

const resolveOfficerCity = (meta: Record<string, unknown>): number => {
    const camel = asNumber(meta.officerCity, 0);
    if (camel > 0) {
        return camel;
    }
    return asNumber(meta.officer_city, 0);
};

const resolveCityTrust = (meta: Record<string, unknown>): number => {
    const trust = asNumber(meta.trust, 50);
    return trust;
};

const toIncomeCity = (city: ReturnType<InMemoryTurnWorld['listCities']>[number]): CityIncomeSource => ({
    id: city.id,
    population: city.population,
    populationMax: city.populationMax,
    agriculture: city.agriculture,
    agricultureMax: city.agricultureMax,
    commerce: city.commerce,
    commerceMax: city.commerceMax,
    security: city.security,
    securityMax: city.securityMax,
    trust: resolveCityTrust(asRecord(city.meta)),
    supplyState: city.supplyState,
    defence: city.defence,
    defenceMax: city.defenceMax,
    wall: city.wall,
    wallMax: city.wallMax,
    meta: asRecord(city.meta),
});

const buildNationIncomeContext = (nation: Nation, trait: NationTraitModule | null): NationIncomeContext => {
    const actionContext = createIncomeActionContext(nation);
    const modifyIncome = trait?.onCalcNationalIncome
        ? (type: TriggerNationalIncomeType, amount: number) => trait.onCalcNationalIncome!(actionContext, type, amount)
        : undefined;
    return {
        rate: resolveNationRate(nation),
        modifyIncome,
    };
};

const buildOfficerCountMap = (generals: TurnGeneral[]): Map<number, number> => {
    const officerCntByCity = new Map<number, number>();
    for (const general of generals) {
        if (general.officerLevel < 2 || general.officerLevel > 4) {
            continue;
        }
        const officerCity = resolveOfficerCity(asRecord(general.meta));
        if (!officerCity || general.cityId !== officerCity) {
            continue;
        }
        officerCntByCity.set(officerCity, (officerCntByCity.get(officerCity) ?? 0) + 1);
    }
    return officerCntByCity;
};

const pushLogs = (world: InMemoryTurnWorld, logs: ReturnType<ActionLogger['flush']>): void => {
    for (const log of logs) {
        world.pushLog(log);
    }
};

const roundResource = (value: number): number => Math.round(value);

const applyIncomeOutcome = (
    current: number,
    income: number,
    outcome: number,
    baseResource: number,
    originOutcome: number
): { next: number; ratio: number; realOutcome: number } => {
    let next = current + income;
    let realOutcome: number;
    if (next < baseResource) {
        realOutcome = 0;
        next = baseResource;
    } else if (next - baseResource < outcome) {
        realOutcome = next - baseResource;
        next = baseResource;
    } else {
        realOutcome = outcome;
        next -= realOutcome;
    }

    const ratio = originOutcome > 0 ? realOutcome / originOutcome : 0;
    return { next: Math.max(next, baseResource), ratio, realOutcome };
};

const processIncomeForNation = (
    world: InMemoryTurnWorld,
    nation: Nation,
    generals: TurnGeneral[],
    cities: ReturnType<InMemoryTurnWorld['listCities']>,
    officerCounts: Map<number, number>,
    traitMap: Map<string, NationTraitModule>,
    type: 'gold' | 'rice',
    baseResource: number
): void => {
    const nationCities = cities.filter((city) => city.nationId === nation.id).map(toIncomeCity);
    const nationGenerals = generals.filter((general) => general.nationId === nation.id && general.npcState !== 5);
    const trait = traitMap.get(nation.typeCode) ?? null;
    const incomeContext = buildNationIncomeContext(nation, trait);

    const income =
        type === 'gold'
            ? getGoldIncome(incomeContext, nationCities, officerCounts, nation.capitalCityId ?? 0, nation.level)
            : getRiceIncome(incomeContext, nationCities, officerCounts, nation.capitalCityId ?? 0, nation.level) +
              getWallIncome(incomeContext, nationCities, officerCounts, nation.capitalCityId ?? 0, nation.level);

    const incomeValue = roundResource(income);
    const originOutcome = getOutcome(100, nationGenerals);
    const bill = resolveNationBill(nation);
    const outcome = Math.round((bill / 100) * originOutcome);
    const current = type === 'gold' ? nation.gold : nation.rice;

    const { next, ratio } = applyIncomeOutcome(current, incomeValue, outcome, baseResource, originOutcome);
    const nextMeta = {
        ...nation.meta,
        [`prev_income_${type}`]: incomeValue,
    };

    if (type === 'gold') {
        world.updateNation(nation.id, { gold: next, meta: nextMeta });
    } else {
        world.updateNation(nation.id, { rice: next, meta: nextMeta });
    }

    const incomeText = incomeValue.toLocaleString();
    const incomeLog =
        type === 'gold' ? `이번 수입은 금 <C>${incomeText}</>입니다.` : `이번 수입은 쌀 <C>${incomeText}</>입니다.`;
    for (const general of nationGenerals) {
        const pay = Math.round(getBill(general.dedication) * ratio);
        if (type === 'gold') {
            world.updateGeneral(general.id, { gold: general.gold + pay });
        } else {
            world.updateGeneral(general.id, { rice: general.rice + pay });
        }

        const logger = new ActionLogger({ generalId: general.id, nationId: nation.id });
        if (general.officerLevel > 4) {
            logger.pushGeneralActionLog(incomeLog, LogFormat.PLAIN);
        }
        const payText = pay.toLocaleString();
        const payLog =
            type === 'gold'
                ? `봉급으로 금 <C>${payText}</>을 받았습니다.`
                : `봉급으로 쌀 <C>${payText}</>을 받았습니다.`;
        logger.pushGeneralActionLog(payLog, LogFormat.PLAIN);
        pushLogs(world, logger.flush());
    }
};

export interface IncomeHandler extends TurnCalendarHandler {
    runResource(resource: 'gold' | 'rice'): void;
}

export const createIncomeHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
    scenarioConfig: ScenarioConfig;
    nationTraits: Map<string, NationTraitModule>;
}): IncomeHandler => {
    const constValues = asRecord(options.scenarioConfig.const);
    const baseGold = resolveNumber(constValues, ['baseGold', 'basegold'], 0);
    const baseRice = resolveNumber(constValues, ['baseRice', 'baserice'], 0);

    const runResource = (type: 'gold' | 'rice'): void => {
        const world = options.getWorld();
        if (!world) {
            return;
        }
        const nations = world.listNations();
        const generals = world.listGenerals();
        const cities = world.listCities();

        const byNation: Map<number, TurnGeneral[]> = new Map();
        for (const general of generals) {
            const bucket = byNation.get(general.nationId) ?? [];
            bucket.push(general);
            byNation.set(general.nationId, bucket);
        }

        for (const nation of nations) {
            const nationGenerals = byNation.get(nation.id) ?? [];
            const officerCounts = buildOfficerCountMap(nationGenerals);
            processIncomeForNation(
                world,
                nation,
                nationGenerals,
                cities,
                officerCounts,
                options.nationTraits,
                type,
                type === 'gold' ? baseGold : baseRice
            );
        }

        const logger = new ActionLogger();
        if (type === 'gold') {
            logger.pushGlobalHistoryLog('<W><b>【지급】</b></>봄이 되어 봉록에 따라 자금이 지급됩니다.');
        } else {
            logger.pushGlobalHistoryLog('<W><b>【지급】</b></>가을이 되어 봉록에 따라 군량이 지급됩니다.');
        }
        pushLogs(world, logger.flush());
    };

    const handler: IncomeHandler = {
        runResource,
        onMonthChanged: (context: TurnCalendarContext) => {
            if (context.currentMonth === 1) {
                runResource('gold');
            } else if (context.currentMonth === 7) {
                runResource('rice');
            }
        },
    };

    return handler;
};
