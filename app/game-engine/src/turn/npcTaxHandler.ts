import type { TurnCalendarContext, TurnCalendarHandler, InMemoryTurnWorld } from './inMemoryWorld.js';
import type { City, Nation } from '@sammo-ts/logic';
import { joinYearMonth, readNumber } from './ai/aiUtils.js';

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

const isNpcMonarchNation = (nation: Nation, world: InMemoryTurnWorld): boolean => {
    if (!nation.capitalCityId || !nation.chiefGeneralId) {
        return false;
    }
    const chief = world.getGeneralById(nation.chiefGeneralId);
    return Boolean(chief && chief.npcState >= 2);
};

export const createNpcTaxHandler = (options: { getWorld: () => InMemoryTurnWorld | null }): TurnCalendarHandler => {
    return {
        onMonthChanged: (context: TurnCalendarContext) => {
            if (!shouldUpdateRate(context.currentMonth)) {
                return;
            }
            const world = options.getWorld();
            if (!world) {
                return;
            }
            const worldState = world.getState();
            const meta = worldState.meta ?? {};
            const initYear = readNumber(meta.initYear, NaN);
            const initMonth = readNumber(meta.initMonth, NaN);
            const hasInit = Number.isFinite(initYear) && Number.isFinite(initMonth);
            const monthsSinceStart = hasInit
                ? joinYearMonth(context.currentYear, context.currentMonth) - joinYearMonth(initYear, initMonth)
                : null;
            const cities = world.listCities();
            for (const nation of world.listNations()) {
                if (!isNpcMonarchNation(nation, world)) {
                    continue;
                }
                const nationCities = cities.filter((city) => city.nationId === nation.id && city.supplyState > 0);
                let rate = resolveNpcTaxRate(nationCities);
                if (monthsSinceStart !== null && monthsSinceStart <= 4) {
                    rate = Math.min(rate, 10);
                }
                world.updateNation(nation.id, {
                    meta: {
                        ...nation.meta,
                        rate,
                    },
                });
            }
        },
    };
};
