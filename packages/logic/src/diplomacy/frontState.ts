export interface FrontStateCity {
    id: number;
    nationId: number;
    frontState: number;
}

export interface FrontStateDiplomacy {
    fromNationId: number;
    toNationId: number;
    state: number;
    term: number;
}

const collectAdjacentCities = (
    cityIds: number[],
    connections: ReadonlyMap<number, readonly number[]>,
    bucket: Set<number>
): void => {
    for (const cityId of cityIds) {
        for (const neighborId of connections.get(cityId) ?? []) {
            bucket.add(neighborId);
        }
    }
};

export const buildNationFrontStatePatches = (options: {
    cities: FrontStateCity[];
    diplomacy: FrontStateDiplomacy[];
    connections: ReadonlyMap<number, readonly number[]>;
    nationIds: number[];
}): Array<{ id: number; frontState: number }> => {
    const cityIdsByNation = new Map<number, number[]>();
    for (const city of options.cities) {
        const list = cityIdsByNation.get(city.nationId) ?? [];
        list.push(city.id);
        cityIdsByNation.set(city.nationId, list);
    }
    const cityById = new Map(options.cities.map((city) => [city.id, city]));
    const patches: Array<{ id: number; frontState: number }> = [];

    for (const nationId of new Set(options.nationIds.filter((id) => id > 0))) {
        const adjWar = new Set<number>();
        const adjNeutral = new Set<number>();
        const adjDeclaration = new Set<number>();

        for (const entry of options.diplomacy) {
            if (entry.fromNationId !== nationId) {
                continue;
            }
            const targetCities = cityIdsByNation.get(entry.toNationId) ?? [];
            if (entry.state === 0) {
                collectAdjacentCities(targetCities, options.connections, adjWar);
            } else if (entry.state === 1 && entry.term <= 5) {
                collectAdjacentCities(targetCities, options.connections, adjDeclaration);
            }
        }

        if (adjWar.size === 0 && adjDeclaration.size === 0) {
            collectAdjacentCities(cityIdsByNation.get(0) ?? [], options.connections, adjNeutral);
        }

        for (const cityId of cityIdsByNation.get(nationId) ?? []) {
            const city = cityById.get(cityId);
            if (!city) {
                continue;
            }
            let frontState = 0;
            if (adjDeclaration.has(cityId)) {
                frontState = 1;
            }
            if (adjNeutral.has(cityId)) {
                frontState = 2;
            }
            if (adjWar.has(cityId)) {
                frontState = 3;
            }
            if (city.frontState !== frontState) {
                patches.push({ id: cityId, frontState });
            }
        }
    }

    return patches;
};
