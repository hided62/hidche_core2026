import type { GeneralAI } from '../core.js';
import { GAME_TICKS_PER_TURN } from '@sammo-ts/common';
import { calcCityDevRatio } from '../../aiUtils.js';
import { searchAllDistanceByCityList } from '@sammo-ts/logic/world/distance.js';

export const do천도 = (ai: GeneralAI) => {
    if (!ai.nation || !ai.nation.capitalCityId) {
        return null;
    }
    if (!ai.map) {
        return null;
    }

    const lastTurn = ai.getLastNationTurn();
    const lastArgs =
        lastTurn.arg && typeof lastTurn.arg === 'object' ? (lastTurn.arg as Record<string, unknown>) : null;
    const lastDestination = Number(lastArgs?.destCityID ?? lastArgs?.destCityId);
    if (
        lastTurn.command === '천도' &&
        Number.isFinite(lastDestination) &&
        lastDestination !== ai.nation.capitalCityId
    ) {
        const continuing = ai.buildNationCandidate('che_천도', { destCityID: lastDestination }, '천도');
        if (continuing) {
            ai.markCapitalMoveTrial();
            return continuing;
        }
    }

    const lastTrial = ai.getLastCapitalMoveTrial();
    const currentTurnTick = ai.general.turnTick;
    if (
        lastTrial &&
        currentTurnTick !== undefined &&
        Math.abs(currentTurnTick - lastTrial[1]) < Math.floor(GAME_TICKS_PER_TURN / 2) &&
        lastTrial[0] !== ai.general.officerLevel
    ) {
        return null;
    }
    const nationCities = Object.values(ai.nationCities);
    if (nationCities.length <= 1) {
        return null;
    }

    const nationCityIds = new Set(nationCities.map((city) => city.id));
    const connectedCityIds = new Set<number>([ai.nation.capitalCityId]);
    const queue = [ai.nation.capitalCityId];
    while (queue.length > 0) {
        const cityId = queue.shift()!;
        const connections = ai.map.cities.find((city) => city.id === cityId)?.connections ?? [];
        for (const nextCityId of connections) {
            if (!nationCityIds.has(nextCityId) || connectedCityIds.has(nextCityId)) {
                continue;
            }
            connectedCityIds.add(nextCityId);
            queue.push(nextCityId);
        }
    }
    if (connectedCityIds.size <= 1) {
        return null;
    }

    const cityIds = Array.from(connectedCityIds);
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
    for (const city of nationCities.filter((candidate) => connectedCityIds.has(candidate.id))) {
        const sumDistance = Object.values(distanceList[city.id] ?? {}).reduce((acc, value) => acc + value, 0);
        if (sumDistance <= 0) {
            continue;
        }
        const dev = calcCityDevRatio(city);
        cityScores[city.id] = city.population * (maxDistance / sumDistance) * Math.sqrt(dev);
    }

    const sorted = Object.entries(cityScores).sort((a, b) => b[1] - a[1]);
    const topLimit = Math.ceil(sorted.length * 0.25);
    for (let idx = 0; idx <= Math.min(topLimit, sorted.length - 1); idx += 1) {
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

    const candidate = ai.buildNationCandidate('che_천도', { destCityID: targetCityId }, '천도');
    if (candidate) ai.markCapitalMoveTrial();
    return candidate;
};
