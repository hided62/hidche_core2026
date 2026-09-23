import { asRecord, isRecord } from '@sammo-ts/common';
import { loadScenarioDefinitionById } from '@sammo-ts/game-engine/scenario/scenarioLoader.js';
import {
    loadLegacyDefaultUniqueItemPool,
    resolveLegacyPurchasableItemKeys,
} from '@sammo-ts/logic/rewards/legacyUniqueItemPool.js';

/** JSONB does not retain the item key order declared by the scenario resource. */
export const loadScenarioItemOrder = async (scenarioCode: string): Promise<readonly string[] | undefined> => {
    const normalized = scenarioCode.replace(/^scenario_/i, '').replace(/\.json$/i, '');
    if (!/^\d+$/.test(normalized) || !Number.isSafeInteger(Number(normalized))) {
        return undefined;
    }
    try {
        const scenario = await loadScenarioDefinitionById(Number(normalized));
        const configConst = scenario.config.const;
        const keys = Object.values(asRecord(configConst.allItems)).flatMap((entries) => Object.keys(asRecord(entries)));
        if (keys.length > 0) return keys;

        const defaultUniques = await loadLegacyDefaultUniqueItemPool();
        return [
            ...resolveLegacyPurchasableItemKeys(configConst),
            ...Object.values(defaultUniques).flatMap((entries) => Object.keys(entries ?? {})),
        ];
    } catch (error) {
        // Old saved seasons can outlive their scenario resource. Keep the stored entries available.
        if (isRecord(error) && error.code === 'ENOENT') return undefined;
        throw error;
    }
};

export const orderScenarioItemEntries = <T>(
    entries: Record<string, T>,
    itemOrder: readonly string[] | undefined
): [string, T][] => {
    const ordered: [string, T][] = [];
    const remaining = new Map(Object.entries(entries));
    for (const key of itemOrder ?? []) {
        if (!remaining.has(key)) continue;
        ordered.push([key, remaining.get(key)!]);
        remaining.delete(key);
    }
    return [...ordered, ...remaining];
};
