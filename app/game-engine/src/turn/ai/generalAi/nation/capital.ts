import type { GeneralAI } from '../core.js';
import { calcCityDevRatio } from '../../aiUtils.js';
import { searchAllDistanceByCityList } from '../../distance.js';

export const do천도 = (ai: GeneralAI) => {
    if (!ai.nation || !ai.nation.capitalCityId) {
        return null;
    }
    if (!ai.map) {
        return null;
    }
    const nationCities = Object.values(ai.nationCities);
    if (nationCities.length <= 1) {
        return null;
    }

    const cityIds = nationCities.map((city) => city.id);
    const distanceList = searchAllDistanceByCityList(ai.map, cityIds);
    const capitalId = ai.nation.capitalCityId;
    if (!distanceList[capitalId]) {
        return null;
    }

    let maxDistance = 0;
    for (const distances of Object.values(distanceList)) {
        const sum = Object.values(distances).reduce((acc, value) => acc + value, 0);
        maxDistance = Math.max(maxDistance, sum);
    }

    const cityScores: Record<number, number> = {};
    for (const city of nationCities) {
        const sumDistance = Object.values(distanceList[city.id] ?? {}).reduce((acc, value) => acc + value, 0);
        if (sumDistance <= 0) {
            continue;
        }
        const dev = calcCityDevRatio(city);
        cityScores[city.id] = city.population * (maxDistance / sumDistance) * Math.sqrt(dev);
    }

    const sorted = Object.entries(cityScores).sort((a, b) => b[1] - a[1]);
    const topLimit = Math.ceil(sorted.length * 0.25);
    for (let idx = 0; idx < Math.min(topLimit, sorted.length); idx += 1) {
        if (Number(sorted[idx][0]) === capitalId) {
            return null;
        }
    }

    const finalCityId = Number(sorted[0]?.[0]);
    if (!Number.isFinite(finalCityId)) {
        return null;
    }
    const dist = distanceList[capitalId]?.[finalCityId];
    if (dist === undefined) {
        return null;
    }
    let targetCityId = finalCityId;
    if (dist > 1) {
        const connections = ai.map.cities.find((city) => city.id === capitalId)?.connections ?? [];
        const candidates = connections.filter((stopId) => distanceList[stopId]?.[finalCityId] + 1 === dist);
        if (candidates.length > 0) {
            targetCityId = ai.rng.choice(candidates);
        }
    }

    return ai.buildNationCandidate('che_천도', { destCityId: targetCityId }, '천도');
};
