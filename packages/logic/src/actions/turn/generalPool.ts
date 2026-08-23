import { asRecord, type RandomGenerator } from '@sammo-ts/common';

import type { GeneralMeta, StatBlock } from '@sammo-ts/logic/domain/entities.js';

export interface ScenarioGeneralPoolCandidate {
    poolEntryId: number;
    uniqueName: string;
    name: string;
    stats?: StatBlock;
    dex?: [number, number, number, number, number];
    personality?: string | null;
    affinity?: number | null;
    specialDomestic?: string | null;
    specialWar?: string | null;
    imageServer?: number;
    picture?: number | string | null;
    text?: string | null;
    experience?: number;
    dedication?: number;
    weight?: number;
    sourceInfo: Record<string, unknown>;
}

export interface ScenarioGeneralPoolClaim {
    poolEntryId: number;
    uniqueName: string;
    claimedAt: string;
}

const CLAIM_META_KEY = 'scenarioGeneralPoolClaim';

const readFiniteNumber = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

const readOptionalString = (value: unknown): string | null | undefined => {
    if (value === null) {
        return null;
    }
    return typeof value === 'string' ? value : undefined;
};

export const parseScenarioGeneralPoolCandidate = (entry: {
    id: number;
    uniqueName: string;
    info: unknown;
}): ScenarioGeneralPoolCandidate => {
    const info = asRecord(entry.info);
    const name = typeof info.generalName === 'string' && info.generalName !== '' ? info.generalName : entry.uniqueName;
    const leadership = readFiniteNumber(info.leadership);
    const strength = readFiniteNumber(info.strength);
    const intelligence = readFiniteNumber(info.intel);
    const rawDex = Array.isArray(info.dex) ? info.dex.map(readFiniteNumber) : [];
    const dex =
        rawDex.length === 5 && rawDex.every((value): value is number => value !== null)
            ? (rawDex as [number, number, number, number, number])
            : undefined;
    const experience = readFiniteNumber(info.experience);
    const dedication = readFiniteNumber(info.dedication);
    const weight = readFiniteNumber(info.weight);
    const imageServer = readFiniteNumber(info.imgsvr);
    const specialDomestic = readOptionalString(info.specialDomestic);
    const specialWar = readOptionalString(info.specialWar);

    return {
        poolEntryId: entry.id,
        uniqueName: entry.uniqueName,
        name,
        sourceInfo: structuredClone(info),
        ...(leadership !== null && strength !== null && intelligence !== null
            ? {
                  stats: {
                      leadership,
                      strength,
                      intelligence,
                  },
              }
            : {}),
        ...(dex ? { dex } : {}),
        ...(specialDomestic !== undefined ? { specialDomestic } : {}),
        ...(specialWar !== undefined ? { specialWar } : {}),
        ...(imageServer !== null ? { imageServer } : {}),
        ...(info.picture === null || typeof info.picture === 'string' || typeof info.picture === 'number'
            ? { picture: info.picture }
            : {}),
        ...(experience !== null ? { experience } : {}),
        ...(dedication !== null ? { dedication } : {}),
        ...(weight !== null ? { weight } : {}),
    };
};

export const buildScenarioGeneralPoolClaimMeta = (
    candidate: ScenarioGeneralPoolCandidate,
    claimedAt: Date
): Pick<GeneralMeta, typeof CLAIM_META_KEY> => ({
    [CLAIM_META_KEY]: {
        poolEntryId: candidate.poolEntryId,
        uniqueName: candidate.uniqueName,
        claimedAt: claimedAt.toISOString(),
    },
});

export const readScenarioGeneralPoolClaim = (meta: Record<string, unknown>): ScenarioGeneralPoolClaim | null => {
    const raw = asRecord(meta[CLAIM_META_KEY]);
    const poolEntryId = readFiniteNumber(raw.poolEntryId);
    if (
        poolEntryId === null ||
        !Number.isSafeInteger(poolEntryId) ||
        poolEntryId <= 0 ||
        typeof raw.uniqueName !== 'string' ||
        raw.uniqueName === '' ||
        typeof raw.claimedAt !== 'string' ||
        Number.isNaN(new Date(raw.claimedAt).getTime())
    ) {
        return null;
    }
    return {
        poolEntryId,
        uniqueName: raw.uniqueName,
        claimedAt: raw.claimedAt,
    };
};

export const getScenarioGeneralPoolCandidateWeight = (candidate: ScenarioGeneralPoolCandidate): number => {
    const weight = candidate.weight ?? candidate.dex?.reduce((sum, value) => sum + value, 0) ?? 0;
    // SPoolUnderU100 gives NPC/system draws (owner <= 0) a minimum weight so
    // zero-dex growth candidates remain selectable. User selection calculates
    // its distinct owner-aware weight in selectPoolService.
    return candidate.sourceInfo.event100Growth === true ? Math.max(100_000, weight) : weight;
};

const pickUsingWeightPair = <T>(rng: RandomGenerator, values: Array<[T, number]>): T => {
    let total = 0;
    for (const [, weight] of values) {
        if (weight > 0) {
            total += weight;
        }
    }
    let cursor = rng.nextFloat1() * total;
    for (const [value, weight] of values) {
        if (weight <= 0) {
            if (cursor <= 0) {
                return value;
            }
            continue;
        }
        if (cursor <= weight) {
            return value;
        }
        cursor -= weight;
    }
    throw new Error('Unreachable weighted general-pool selection.');
};

/**
 * Ref keeps the original weighted array while retrying duplicate pool IDs.
 * A duplicate draw therefore consumes RNG instead of shrinking the weights.
 */
export const pickUniqueScenarioGeneralPoolCandidates = (
    rng: RandomGenerator,
    candidates: readonly ScenarioGeneralPoolCandidate[],
    count: number
): ScenarioGeneralPoolCandidate[] => {
    if (count <= 0) {
        return [];
    }
    if (candidates.length < count) {
        throw new Error('pool 부족');
    }
    const weighted = candidates.map(
        (candidate) =>
            [candidate, getScenarioGeneralPoolCandidateWeight(candidate)] as [ScenarioGeneralPoolCandidate, number]
    );
    const selectedIds = new Set<number>();
    const selected: ScenarioGeneralPoolCandidate[] = [];
    while (selected.length < count) {
        const candidate = pickUsingWeightPair(rng, weighted);
        if (selectedIds.has(candidate.poolEntryId)) {
            continue;
        }
        selectedIds.add(candidate.poolEntryId);
        selected.push(candidate);
    }
    return selected;
};

export type LegacyNpcStatType = '무' | '지' | '무지';

export const resolveLegacyNpcStatTypeFromFixedStats = (rng: RandomGenerator, stats: StatBlock): LegacyNpcStatType => {
    if (stats.leadership < 40) {
        return '무지';
    }
    if (stats.intelligence * 0.8 > stats.strength) {
        return '지';
    }
    if (stats.strength * 0.8 > stats.intelligence) {
        return '무';
    }
    return pickUsingWeightPair(rng, [
        ['무', stats.strength],
        ['지', stats.intelligence],
    ]);
};
