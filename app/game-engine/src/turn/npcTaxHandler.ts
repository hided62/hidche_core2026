import { asRecord } from '@sammo-ts/common';
import {
    createIncomeActionContext,
    getGoldIncome,
    getOutcome,
    getRiceIncome,
    getWallIncome,
    getWarGoldIncome,
    type City,
    type CityIncomeSource,
    type Nation,
    type NationIncomeContext,
    type NationTraitModule,
    type ScenarioConfig,
    type TurnCommandEnv,
    type UnitSetDefinition,
} from '@sammo-ts/logic';

import type { TurnCalendarContext, TurnCalendarHandler, InMemoryTurnWorld } from './inMemoryWorld.js';
import { readNumber } from './ai/aiUtils.js';
import { shouldUseNationAi } from './ai/generalAi.js';
import { AutorunNationPolicy, canUseRulerAutomation } from './ai/policies.js';

const calcNationDevelopedRate = (cities: City[]): { pop: number; all: number } => {
    if (cities.length === 0) {
        return { pop: 0, all: 0 };
    }
    let pop = 0;
    let agri = 0;
    let comm = 0;
    let secu = 0;
    let def = 0;
    let wall = 0;
    for (const city of cities) {
        pop += city.populationMax > 0 ? city.population / city.populationMax : 0;
        agri += city.agricultureMax > 0 ? city.agriculture / city.agricultureMax : 0;
        comm += city.commerceMax > 0 ? city.commerce / city.commerceMax : 0;
        secu += city.securityMax > 0 ? city.security / city.securityMax : 0;
        def += city.defenceMax > 0 ? city.defence / city.defenceMax : 0;
        wall += city.wallMax > 0 ? city.wall / city.wallMax : 0;
    }
    const count = cities.length;
    pop /= count;
    agri /= count;
    comm /= count;
    secu /= count;
    def /= count;
    wall /= count;
    const all = (pop + agri + comm + secu + def + wall) / 6;
    return { pop, all };
};

const resolveNpcTaxRate = (cities: City[]): number => {
    if (cities.length === 0) {
        return 15;
    }
    const devRate = calcNationDevelopedRate(cities);
    const avg = (devRate.pop + devRate.all) / 2;
    if (avg > 0.95) {
        return 25;
    }
    if (avg > 0.7) {
        return 20;
    }
    if (avg > 0.5) {
        return 15;
    }
    return 10;
};

const shouldUpdateRate = (month: number): boolean => month === 6 || month === 12;

const toIncomeCity = (city: City): CityIncomeSource => ({
    id: city.id,
    population: city.population,
    populationMax: city.populationMax,
    agriculture: city.agriculture,
    agricultureMax: city.agricultureMax,
    commerce: city.commerce,
    commerceMax: city.commerceMax,
    security: city.security,
    securityMax: city.securityMax,
    trust: readNumber(asRecord(city.meta).trust, 50),
    supplyState: city.supplyState,
    defence: city.defence,
    defenceMax: city.defenceMax,
    wall: city.wall,
    wallMax: city.wallMax,
    meta: asRecord(city.meta),
});

const buildOfficerCounts = (world: InMemoryTurnWorld, nationId: number): Map<number, number> => {
    const result = new Map<number, number>();
    for (const general of world.listGenerals()) {
        if (general.nationId !== nationId || general.officerLevel < 2 || general.officerLevel > 4) continue;
        const officerCity = readNumber(asRecord(general.meta).officer_city, 0);
        if (officerCity > 0 && general.cityId === officerCity) {
            result.set(officerCity, (result.get(officerCity) ?? 0) + 1);
        }
    }
    return result;
};

const clampBill = (value: number): number => Math.max(20, Math.min(200, Math.trunc(value)));

const resolveNpcMonarch = (nation: Nation, world: InMemoryTurnWorld) => {
    const chief = nation.chiefGeneralId
        ? world.getGeneralById(nation.chiefGeneralId)
        : world
              .listGenerals()
              .find((general) => general.nationId === nation.id && general.officerLevel === 12) ?? null;
    return chief && canUseRulerAutomation(chief, 'finance') && shouldUseNationAi(chief, world.getState())
        ? chief
        : null;
};

type NpcFinanceOptions = {
    commandEnv?: TurnCommandEnv;
    scenarioConfig?: ScenarioConfig;
    unitSet?: UnitSetDefinition;
    nationTraits?: ReadonlyMap<string, NationTraitModule>;
};

export const calculateNpcNationFinance = (
    world: InMemoryTurnWorld,
    nation: Nation,
    currentMonth: number,
    options: NpcFinanceOptions
): Nation['meta'] | null => {
    if (!shouldUpdateRate(currentMonth)) {
        return null;
    }
    const chief = resolveNpcMonarch(nation, world);
    if (!chief) return null;
    const cities = world.listCities();
    const rawNationCities = cities.filter((city) => city.nationId === nation.id && city.supplyState > 0);
    const rate = resolveNpcTaxRate(rawNationCities);
    // Ref chooses the default rate during the ruler turn even when a newly
    // founded nation has not supplied its first city yet.  In that state it
    // leaves the existing bill untouched because there is no income basis.
    if (rawNationCities.length === 0) {
        return { ...nation.meta, rate };
    }
    if (!options.commandEnv || !options.scenarioConfig) {
        return { ...nation.meta, rate };
    }
    const trait = options.nationTraits?.get(nation.typeCode);
    const actionContext = createIncomeActionContext(nation);
    const incomeContext: NationIncomeContext = {
        rate,
        ...(trait?.onCalcNationalIncome
            ? { modifyIncome: (type, amount) => trait.onCalcNationalIncome!(actionContext, type, amount) }
            : {}),
    };
    const nationCities = rawNationCities.map(toIncomeCity);
    const officerCounts = buildOfficerCounts(world, nation.id);
    const generals = world
        .listGenerals()
        // Ref's GeneralAI::$nationGenerals is built with `no != current ruler`.
        // chooseGoldBillRate therefore omits the ruler's own stipend from the
        // outcome used to choose bill, despite a dead local append that looks
        // as if it intended to include the ruler.
        .filter((general) => general.nationId === nation.id && general.id !== chief.id && general.npcState !== 5);
    const outcome = Math.max(1, getOutcome(100, generals));
    const policy = new AutorunNationPolicy({
        general: chief,
        aiOptions: null,
        nationPolicy: asRecord(nation.meta).npc_nation_policy as Record<string, unknown> | null,
        serverPolicy: asRecord(world.getState().meta).npc_nation_policy as Record<string, unknown> | null,
        nation,
        env: options.commandEnv,
        scenarioConfig: options.scenarioConfig,
        ...(options.unitSet ? { unitSet: options.unitSet } : {}),
    });
    const income =
        currentMonth === 12
            ? getGoldIncome(incomeContext, nationCities, officerCounts, nation.capitalCityId, nation.level) +
              getWarGoldIncome(incomeContext, nationCities)
            : getRiceIncome(incomeContext, nationCities, officerCounts, nation.capitalCityId, nation.level) +
              getWallIncome(incomeContext, nationCities, officerCounts, nation.capitalCityId, nation.level);
    const currentResource = currentMonth === 12 ? nation.gold : nation.rice;
    const requiredResource = currentMonth === 12 ? policy.reqNationGold : policy.reqNationRice;
    let bill = Math.trunc((income / outcome) * 90);
    if (currentResource + income - outcome > requiredResource * 2) {
        const moreBill = ((currentResource + income - requiredResource * 2) / outcome) * 80;
        if (moreBill > bill) bill = Math.trunc((moreBill + bill) / 2);
    }
    return { ...nation.meta, rate, bill: clampBill(bill) };
};

export const createNpcTaxHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
    commandEnv?: TurnCommandEnv;
    scenarioConfig?: ScenarioConfig;
    unitSet?: UnitSetDefinition;
    nationTraits?: ReadonlyMap<string, NationTraitModule>;
}): TurnCalendarHandler => {
    return {
        onMonthChanged: (context: TurnCalendarContext) => {
            if (!shouldUpdateRate(context.currentMonth)) {
                return;
            }
            const world = options.getWorld();
            if (!world) {
                return;
            }
            for (const nation of world.listNations()) {
                const nextMeta = calculateNpcNationFinance(world, nation, context.currentMonth, options);
                if (nextMeta) world.updateNation(nation.id, { meta: nextMeta });
            }
        },
    };
};
