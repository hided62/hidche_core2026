import { JosaUtil } from '@sammo-ts/common';
import { LogCategory, LogFormat, LogScope, type MapDefinition } from '@sammo-ts/logic';

import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import type { MonthlyEventActionHandler } from './monthlyEventHandler.js';

const roundIntegerState = (value: number): number => Math.round(value);

const resolveOfficerCity = (meta: Record<string, unknown>): number => {
    const camel = meta.officerCity;
    if (typeof camel === 'number' && Number.isFinite(camel)) {
        return Math.floor(camel);
    }
    const snake = meta.officer_city;
    return typeof snake === 'number' && Number.isFinite(snake) ? Math.floor(snake) : 0;
};

export const createUpdateCitySupplyHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
    map: MapDefinition;
}): MonthlyEventActionHandler => {
    const mapCityById = new Map(options.map.cities.map((city) => [city.id, city]));

    return (_args, environment) => {
        const world = options.getWorld();
        if (!world) {
            return;
        }

        const cities = world.listCities().sort((left, right) => left.id - right.id);
        const ownedCityById = new Map(
            cities.filter((city) => city.nationId !== 0).map((city) => [city.id, { ...city, supplied: false }])
        );
        const queue: Array<{ id: number; nationId: number }> = [];

        for (const nation of world
            .listNations()
            .filter((candidate) => candidate.level > 0)
            .sort((left, right) => left.id - right.id)) {
            if (nation.capitalCityId === null) {
                continue;
            }
            const capital = ownedCityById.get(nation.capitalCityId);
            if (!capital || capital.nationId !== nation.id) {
                continue;
            }
            capital.supplied = true;
            queue.push({ id: capital.id, nationId: nation.id });
        }

        for (let cursor = 0; cursor < queue.length; cursor += 1) {
            const current = queue[cursor]!;
            const mapCity = mapCityById.get(current.id);
            if (!mapCity) {
                throw new Error(`UpdateCitySupply map city is missing (cityId=${current.id})`);
            }
            for (const connectedCityId of mapCity.connections) {
                const connected = ownedCityById.get(connectedCityId);
                if (!connected || connected.nationId !== current.nationId || connected.supplied) {
                    continue;
                }
                connected.supplied = true;
                queue.push({ id: connected.id, nationId: current.nationId });
            }
        }

        const unsuppliedCities = [];
        for (const city of cities) {
            const supplied = city.nationId === 0 || ownedCityById.get(city.id)?.supplied === true;
            if (supplied) {
                world.updateCity(city.id, { supplyState: 1 });
                continue;
            }
            const trust = typeof city.meta.trust === 'number' ? city.meta.trust : 0;
            const damaged = world.updateCity(city.id, {
                supplyState: 0,
                population: roundIntegerState(city.population * 0.9),
                agriculture: roundIntegerState(city.agriculture * 0.9),
                commerce: roundIntegerState(city.commerce * 0.9),
                security: roundIntegerState(city.security * 0.9),
                defence: roundIntegerState(city.defence * 0.9),
                wall: roundIntegerState(city.wall * 0.9),
                meta: {
                    ...city.meta,
                    trust: trust * 0.9,
                },
            });
            if (damaged) {
                unsuppliedCities.push(damaged);
            }
        }

        const generals = world.listGenerals().sort((left, right) => left.id - right.id);
        const unsuppliedNationByCityId = new Map(unsuppliedCities.map((city) => [city.id, city.nationId]));
        for (const general of generals) {
            if (unsuppliedNationByCityId.get(general.cityId) !== general.nationId) {
                continue;
            }
            world.updateGeneral(general.id, {
                crew: roundIntegerState(general.crew * 0.95),
                atmos: roundIntegerState(general.atmos * 0.95),
                train: roundIntegerState(general.train * 0.95),
            });
        }

        const lostCities = unsuppliedCities.filter((city) => {
            const trust = city.meta.trust;
            return typeof trust === 'number' && trust < 30;
        });
        if (lostCities.length === 0) {
            return;
        }

        const lostCityIds = new Set(lostCities.map((city) => city.id));
        for (const lostCity of lostCities) {
            const josaYi = JosaUtil.pick(lostCity.name, '이');
            world.pushLog({
                scope: LogScope.SYSTEM,
                category: LogCategory.HISTORY,
                text: `<R><b>【고립】</b></><G><b>${lostCity.name}</b></>${josaYi} 보급이 끊겨 <R>미지배</> 도시가 되었습니다.`,
                format: LogFormat.YEAR_MONTH,
                year: environment.year,
                month: environment.month,
            });
        }

        for (const general of generals) {
            if (!lostCityIds.has(resolveOfficerCity(general.meta))) {
                continue;
            }
            const current = world.getGeneralById(general.id);
            if (!current) {
                continue;
            }
            world.updateGeneral(general.id, {
                officerLevel: 1,
                meta: {
                    ...current.meta,
                    officerCity: 0,
                    officer_city: 0,
                },
            });
        }
        for (const lostCity of lostCities) {
            world.updateCity(lostCity.id, {
                nationId: 0,
                frontState: 0,
                conflict: {},
                meta: {
                    ...lostCity.meta,
                    officer_set: 0,
                    term: 0,
                },
            });
        }
    };
};
