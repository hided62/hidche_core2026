import { asNumber } from '@sammo-ts/common';
import { createIncomeActionContext, type NationTraitModule } from '@sammo-ts/logic';

import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import type { MonthlyEventActionHandler } from './monthlyEventHandler.js';
import { resolveAppliedNationRate } from './nationTaxRate.js';

type SemiAnnualResource = 'gold' | 'rice';

// REF-COMPAT:BEGIN ref-decimal-half-stabilization
const roundLegacyIntegerColumn = (value: number): number => {
    // MariaDB evaluates the decimal rate expression before ROUND(). Binary
    // arithmetic can instead produce values such as 2029.4999999999998.
    const stabilized = Number(value.toPrecision(15));
    return stabilized >= 0 ? Math.floor(stabilized + 0.5) : Math.ceil(stabilized - 0.5);
};
// REF-COMPAT:END ref-decimal-half-stabilization

const parseResource = (args: readonly unknown[]): SemiAnnualResource => {
    const resource = args[0];
    if (resource !== 'gold' && resource !== 'rice') {
        throw new Error('ProcessSemiAnnual requires resource "gold" or "rice".');
    }
    return resource;
};

const resolveBasePopulationIncrease = (world: InMemoryTurnWorld): number => {
    const value = world.getScenarioConfig().const.basePopIncreaseAmount;
    return typeof value === 'number' && Number.isFinite(value) ? value : 5_000;
};

const decayDomesticValue = (value: number): number => roundLegacyIntegerColumn(value * 0.99);

// REF-COMPAT:BEGIN ref-mariadb-float-boundary
export const storeLegacySemiAnnualTrust = (value: number): number => Math.fround(Math.max(0, Math.min(100, value)));
// REF-COMPAT:END ref-mariadb-float-boundary

const applyResourceMaintenance = (value: number, ratios: readonly [number, number][]): number => {
    if (value <= 1_000) {
        return value;
    }
    for (const [threshold, ratio] of ratios) {
        if (value > threshold) {
            return roundLegacyIntegerColumn(value * ratio);
        }
    }
    return roundLegacyIntegerColumn(value * 0.99);
};

export const createProcessSemiAnnualHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
    nationTraits?: ReadonlyMap<string, NationTraitModule>;
}): MonthlyEventActionHandler => {
    return (args) => {
        const world = options.getWorld();
        if (!world) {
            return;
        }
        const resource = parseResource(args);

        // 레거시의 첫 UPDATE는 모든 도시의 사상자를 초기화하고 내정치를
        // 1% 감소시킨다. 각 SQL 문 사이의 정수 column 반올림도 보존한다.
        for (const city of world.listCities()) {
            world.updateCity(city.id, {
                agriculture: decayDomesticValue(city.agriculture),
                commerce: decayDomesticValue(city.commerce),
                security: decayDomesticValue(city.security),
                defence: decayDomesticValue(city.defence),
                wall: decayDomesticValue(city.wall),
                meta: {
                    ...city.meta,
                    dead: 0,
                },
            });
        }

        // run()은 같은 이름의 class method가 아니라 전역 popIncrease()를
        // 호출한다. 이 때문에 중립 도시는 내정치 1% 감소를 한 번 더 받는다.
        for (const city of world.listCities().filter((candidate) => candidate.nationId === 0)) {
            world.updateCity(city.id, {
                agriculture: decayDomesticValue(city.agriculture),
                commerce: decayDomesticValue(city.commerce),
                security: decayDomesticValue(city.security),
                defence: decayDomesticValue(city.defence),
                wall: decayDomesticValue(city.wall),
                meta: {
                    ...city.meta,
                    trust: 50,
                },
            });
        }

        const basePopulationIncrease = resolveBasePopulationIncrease(world);
        for (const nation of world.listNations()) {
            if (nation.id <= 0) {
                continue;
            }
            const rate = resolveAppliedNationRate(nation.meta);
            let populationRatio = (30 - rate) / 200;
            const trait = options.nationTraits?.get(nation.typeCode);
            if (trait?.onCalcNationalIncome) {
                populationRatio = trait.onCalcNationalIncome(createIncomeActionContext(nation), 'pop', populationRatio);
            }
            const genericRatio = (20 - rate) / 200;
            const trustDiff = 20 - rate;

            for (const city of world
                .listCities()
                .filter((candidate) => candidate.nationId === nation.id && candidate.supplyState === 1)) {
                if (city.securityMax <= 0) {
                    throw new Error(`ProcessSemiAnnual requires positive securityMax (cityId=${city.id}).`);
                }
                const securityRatio = city.security / city.securityMax / 10;
                const populationFactor =
                    populationRatio >= 0
                        ? 1 + populationRatio * (1 + securityRatio)
                        : 1 + populationRatio * (1 - securityRatio);
                const trust = asNumber(city.meta.trust, 50);
                world.updateCity(city.id, {
                    population: roundLegacyIntegerColumn(
                        Math.min(city.populationMax, basePopulationIncrease + city.population * populationFactor)
                    ),
                    agriculture: roundLegacyIntegerColumn(
                        Math.min(city.agricultureMax, city.agriculture * (1 + genericRatio))
                    ),
                    commerce: roundLegacyIntegerColumn(Math.min(city.commerceMax, city.commerce * (1 + genericRatio))),
                    security: roundLegacyIntegerColumn(Math.min(city.securityMax, city.security * (1 + genericRatio))),
                    defence: roundLegacyIntegerColumn(Math.min(city.defenceMax, city.defence * (1 + genericRatio))),
                    wall: roundLegacyIntegerColumn(Math.min(city.wallMax, city.wall * (1 + genericRatio))),
                    meta: {
                        ...city.meta,
                        // Ref's UPDATE persists trust to a MariaDB FLOAT before
                        // the next monthly action reads it. Core stores this
                        // field in JSON, so emulate that binary32 boundary here.
                        trust: storeLegacySemiAnnualTrust(trust + trustDiff),
                    },
                });
            }
        }

        for (const general of world.listGenerals()) {
            const current = general[resource];
            const next = applyResourceMaintenance(current, [[10_000, 0.97]]);
            if (
                process.env.SEED_PARITY_MONTHLY_RESOURCE_TRACE === '1' &&
                (process.env.AI_TRACE_GENERAL_IDS ?? '').split(',').includes(String(general.id))
            ) {
                process.stdout.write(
                    `MONTHLY_RESOURCE_CORE ${JSON.stringify({ action: 'ProcessSemiAnnual', resource, generalId: general.id, current, next })}\n`
                );
            }
            if (next !== current) {
                world.updateGeneral(general.id, { [resource]: next });
            }
        }
        for (const nation of world.listNations()) {
            const current = nation[resource];
            const next = applyResourceMaintenance(current, [
                [100_000, 0.95],
                [10_000, 0.97],
            ]);
            if (next !== current) {
                world.updateNation(nation.id, { [resource]: next });
            }
        }
    };
};
