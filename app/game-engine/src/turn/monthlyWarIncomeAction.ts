import { asNumber, asRecord } from '@sammo-ts/common';
import {
    createIncomeActionContext,
    getWarGoldIncome,
    type CityIncomeSource,
    type NationIncomeContext,
    type NationTraitModule,
    type TriggerNationalIncomeType,
} from '@sammo-ts/logic';

import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import type { MonthlyEventActionHandler } from './monthlyEventHandler.js';

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
    trust: asNumber(city.meta.trust, 50),
    supplyState: city.supplyState,
    defence: city.defence,
    defenceMax: city.defenceMax,
    wall: city.wall,
    wallMax: city.wallMax,
    meta: asRecord(city.meta),
});

export const createProcessWarIncomeHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
    nationTraits?: ReadonlyMap<string, NationTraitModule>;
}): MonthlyEventActionHandler => {
    return () => {
        const world = options.getWorld();
        if (!world) {
            return;
        }

        // 레거시는 부상병을 인구로 돌려보내기 전에 각 국가의 공급 도시에서
        // dead/10을 합산한다. 국가 타입의 금 수입 modifier도 도시별로 적용된다.
        const cities = world.listCities();
        for (const nation of world.listNations()) {
            if (nation.level <= 0) {
                continue;
            }
            const trait = options.nationTraits?.get(nation.typeCode);
            const actionContext = createIncomeActionContext(nation);
            const modifyIncome = trait?.onCalcNationalIncome
                ? (type: TriggerNationalIncomeType, amount: number) =>
                      trait.onCalcNationalIncome!(actionContext, type, amount)
                : undefined;
            const incomeContext: NationIncomeContext = {
                rate: asNumber(nation.meta.rate, 20),
                modifyIncome,
            };
            const income = getWarGoldIncome(
                incomeContext,
                cities.filter((city) => city.nationId === nation.id).map(toIncomeCity)
            );
            world.updateNation(nation.id, { gold: nation.gold + income });
        }

        // 수입 계산이 끝난 뒤 모든 도시가 부상병 20%를 인구로 회복하고
        // dead를 초기화한다. 레거시는 pop_max로 제한하지 않는다.
        for (const city of cities) {
            const dead = asNumber(city.meta.dead, 0);
            world.updateCity(city.id, {
                // MariaDB rounds the SQL expression when assigning it to
                // Ref's integer pop column (including an exact .5 result).
                population: Math.round(city.population + dead * 0.2),
                meta: {
                    ...city.meta,
                    dead: 0,
                },
            });
        }
    };
};
