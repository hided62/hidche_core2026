import type { General, Nation } from '../domain/entities.js';
import type { GeneralActionContext } from '../triggers/general.js';
import type { TriggerNationalIncomeType } from '../triggers/types.js';

export type NationIncomeModifier = (type: TriggerNationalIncomeType, amount: number) => number;

export interface NationIncomeContext {
    rate: number;
    modifyIncome?: NationIncomeModifier;
}

export interface CityIncomeSource {
    id: number;
    population: number;
    populationMax: number;
    agriculture: number;
    agricultureMax: number;
    commerce: number;
    commerceMax: number;
    security: number;
    securityMax: number;
    trust: number;
    supplyState: number;
    defence: number;
    defenceMax: number;
    wall: number;
    wallMax: number;
    meta: Record<string, unknown>;
}

const MAX_DED_LEVEL = 30;

const readMetaNumber = (meta: Record<string, unknown>, key: string, fallback = 0): number => {
    const value = meta[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    return fallback;
};

const applyNationIncome = (context: NationIncomeContext, type: TriggerNationalIncomeType, amount: number): number => {
    if (!context.modifyIncome) {
        return amount;
    }
    return context.modifyIncome(type, amount);
};

export const createIncomeActionContext = (nation: Nation): GeneralActionContext => {
    const general: General = {
        id: 0,
        name: 'SYSTEM',
        nationId: nation.id,
        cityId: 0,
        troopId: 0,
        stats: { leadership: 0, strength: 0, intelligence: 0 },
        experience: 0,
        dedication: 0,
        officerLevel: 0,
        role: {
            personality: null,
            specialDomestic: null,
            specialWar: null,
            items: {
                horse: null,
                weapon: null,
                book: null,
                item: null,
            },
        },
        injury: 0,
        gold: 0,
        rice: 0,
        crew: 0,
        crewTypeId: 0,
        train: 0,
        atmos: 0,
        age: 0,
        npcState: 0,
        triggerState: {
            flags: {},
            counters: {},
            modifiers: {},
            meta: {},
        },
        meta: { killturn: 0 },
    };
    return { general, nation };
};

export const calcCityGoldIncomeBase = (
    context: NationIncomeContext,
    city: CityIncomeSource,
    officerCnt: number,
    isCapital: boolean,
    nationLevel: number
): number => {
    if (city.supplyState === 0) {
        return 0;
    }
    const trustRatio = city.trust / 200 + 0.5;
    const commMax = Math.max(1, city.commerceMax);
    const secuMax = Math.max(1, city.securityMax);

    let income = (city.population * city.commerce * trustRatio) / commMax / 30;
    income *= 1 + city.security / secuMax / 10;
    income *= Math.pow(1.05, officerCnt);
    if (isCapital && nationLevel > 0) {
        income *= 1 + 1 / (3 * nationLevel);
    }

    const adjusted = applyNationIncome(context, 'gold', income);
    return Math.round(adjusted);
};

export const calcCityRiceIncomeBase = (
    context: NationIncomeContext,
    city: CityIncomeSource,
    officerCnt: number,
    isCapital: boolean,
    nationLevel: number
): number => {
    if (city.supplyState === 0) {
        return 0;
    }
    const trustRatio = city.trust / 200 + 0.5;
    const agriMax = Math.max(1, city.agricultureMax);
    const secuMax = Math.max(1, city.securityMax);

    let income = (city.population * city.agriculture * trustRatio) / agriMax / 30;
    income *= 1 + city.security / secuMax / 10;
    income *= Math.pow(1.05, officerCnt);
    if (isCapital && nationLevel > 0) {
        income *= 1 + 1 / (3 * nationLevel);
    }

    const adjusted = applyNationIncome(context, 'rice', income);
    return Math.round(adjusted);
};

export const calcCityWallIncomeBase = (
    context: NationIncomeContext,
    city: CityIncomeSource,
    officerCnt: number,
    isCapital: boolean,
    nationLevel: number
): number => {
    if (city.supplyState === 0) {
        return 0;
    }
    const wallMax = Math.max(1, city.wallMax);
    const secuMax = Math.max(1, city.securityMax);

    let income = (city.defence * city.wall) / wallMax / 3;
    income *= 1 + city.security / secuMax / 10;
    income *= Math.pow(1.05, officerCnt);
    if (isCapital && nationLevel > 0) {
        income *= 1 + 1 / (3 * nationLevel);
    }

    const adjusted = applyNationIncome(context, 'rice', income);
    return Math.round(adjusted);
};

export const calcCityWarGoldIncome = (context: NationIncomeContext, city: CityIncomeSource): number => {
    if (city.supplyState === 0) {
        return 0;
    }
    const dead = readMetaNumber(city.meta as Record<string, unknown>, 'dead', 0);
    const income = dead / 10;
    const adjusted = applyNationIncome(context, 'gold', income);
    return Math.round(adjusted);
};

export const calcCityGoldIncome = (
    context: NationIncomeContext,
    city: CityIncomeSource,
    officerCnt: number,
    isCapital: boolean,
    nationLevel: number
): number => {
    const base = calcCityGoldIncomeBase(context, city, officerCnt, isCapital, nationLevel);
    return Math.round(base * (context.rate / 20));
};

export const calcCityRiceIncome = (
    context: NationIncomeContext,
    city: CityIncomeSource,
    officerCnt: number,
    isCapital: boolean,
    nationLevel: number
): number => {
    const base = calcCityRiceIncomeBase(context, city, officerCnt, isCapital, nationLevel);
    return Math.round(base * (context.rate / 20));
};

export const calcCityWallIncome = (
    context: NationIncomeContext,
    city: CityIncomeSource,
    officerCnt: number,
    isCapital: boolean,
    nationLevel: number
): number => {
    const base = calcCityWallIncomeBase(context, city, officerCnt, isCapital, nationLevel);
    return Math.round(base * (context.rate / 20));
};

export const getGoldIncome = (
    context: NationIncomeContext,
    cities: CityIncomeSource[],
    officerCounts: Map<number, number>,
    capitalCityId: number | null,
    nationLevel: number
): number => {
    let total = 0;
    for (const city of cities) {
        const officerCnt = officerCounts.get(city.id) ?? 0;
        total += calcCityGoldIncomeBase(context, city, officerCnt, capitalCityId === city.id, nationLevel);
    }
    return total * (context.rate / 20);
};

export const getRiceIncome = (
    context: NationIncomeContext,
    cities: CityIncomeSource[],
    officerCounts: Map<number, number>,
    capitalCityId: number | null,
    nationLevel: number
): number => {
    let total = 0;
    for (const city of cities) {
        const officerCnt = officerCounts.get(city.id) ?? 0;
        total += calcCityRiceIncomeBase(context, city, officerCnt, capitalCityId === city.id, nationLevel);
    }
    return total * (context.rate / 20);
};

export const getWallIncome = (
    context: NationIncomeContext,
    cities: CityIncomeSource[],
    officerCounts: Map<number, number>,
    capitalCityId: number | null,
    nationLevel: number
): number => {
    let total = 0;
    for (const city of cities) {
        const officerCnt = officerCounts.get(city.id) ?? 0;
        total += calcCityWallIncomeBase(context, city, officerCnt, capitalCityId === city.id, nationLevel);
    }
    return total * (context.rate / 20);
};

export const getWarGoldIncome = (context: NationIncomeContext, cities: CityIncomeSource[]): number => {
    let total = 0;
    for (const city of cities) {
        total += calcCityWarGoldIncome(context, city);
    }
    return total;
};

export const resolveDedLevel = (dedication: number): number => {
    const level = Math.ceil(Math.sqrt(Math.max(0, dedication)) / 10);
    return Math.max(0, Math.min(MAX_DED_LEVEL, level));
};

export const getBillByLevel = (dedicationLevel: number): number => dedicationLevel * 200 + 400;

export const getBill = (dedication: number): number => getBillByLevel(resolveDedLevel(dedication));

export const getOutcome = (billRate: number, generals: Array<{ dedication: number }>): number => {
    let total = 0;
    for (const general of generals) {
        total += getBill(general.dedication);
    }
    return Math.round(total * (billRate / 100));
};
