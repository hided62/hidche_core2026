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
    resolveCityTrustValue,
    type CityIncomeSource,
    type Nation,
    type NationIncomeContext,
    type NationTraitModule,
    type TriggerNationalIncomeType,
} from '@sammo-ts/logic';

import type { ScenarioConfig } from '@sammo-ts/logic';

import type { InMemoryTurnWorld, TurnCalendarHandler, TurnCalendarContext } from './inMemoryWorld.js';
import { resolveAppliedNationRate } from './nationTaxRate.js';
import type { TurnGeneral } from './types.js';

const DEFAULT_BASE_GOLD = 0;
const DEFAULT_BASE_RICE = 2_000;

const resolveNumber = (source: Record<string, unknown>, keys: string[], fallback: number): number => {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
    }
    return fallback;
};

const resolveNationBill = (nation: Nation): number => asNumber(nation.meta.bill, 100);

export const resolveIncomeCityTrust = (trust: number): number => resolveCityTrustValue(trust);

const resolveOfficerCity = (meta: Record<string, unknown>): number => {
    const camel = asNumber(meta.officerCity, 0);
    if (camel > 0) {
        return camel;
    }
    return asNumber(meta.officer_city, 0);
};

const resolveCityTrust = (meta: Record<string, unknown>): number => {
    return resolveIncomeCityTrust(asNumber(meta.trust, 50));
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
        rate: resolveAppliedNationRate(nation.meta),
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

    // Ref calculates the payout ratio from the pre-persistence income value.
    // Half-unit income (for example 943.5) is therefore not rounded before
    // salaries are distributed, even though the integer nation column is
    // rounded when the final state is flushed to MariaDB.
    const incomeValue = income;
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

    // Ref keeps the fractional pre-flush value for the payout ratio and
    // prev_income_* metadata, but number_format() rounds the user-facing log
    // to the same integer precision as the persisted resource column.
    const incomeText = Math.round(incomeValue).toLocaleString('en-US');
    const incomeLog =
        type === 'gold' ? `이번 수입은 금 <C>${incomeText}</>입니다.` : `이번 수입은 쌀 <C>${incomeText}</>입니다.`;
    for (const general of nationGenerals) {
        const pay = Math.round(getBill(general.dedication) * ratio);
        if (
            process.env.SEED_PARITY_MONTHLY_RESOURCE_TRACE === '1' &&
            (process.env.AI_TRACE_GENERAL_IDS ?? '').split(',').includes(String(general.id))
        ) {
            process.stdout.write(
                `MONTHLY_RESOURCE_CORE ${JSON.stringify({ action: 'ProcessIncome', type, generalId: general.id, current: general[type], pay, ratio, originOutcome })}\n`
            );
        }
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
    const baseGold = resolveNumber(constValues, ['baseGold', 'basegold'], DEFAULT_BASE_GOLD);
    const baseRice = resolveNumber(constValues, ['baseRice', 'baserice'], DEFAULT_BASE_RICE);

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
            if (nation.id <= 0) {
                continue;
            }
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
