import { asNumber, asRecord } from '@sammo-ts/common';

import type { General, GeneralMeta, GeneralRole, StatBlock } from '../domain/entities.js';
import { LEGACY_DEFAULT_MAX_LEVEL } from './constants.js';

export const CENTENNIAL_ALL_STAR_POOL = 'SPoolUnderU100';
export const CENTENNIAL_ALL_STAR_AUX_KEY = 'event100_allstar';
export const CENTENNIAL_ALL_STAR_TRAIT_UNLOCK_PROGRESS = 0.4;
export const CENTENNIAL_ALL_STAR_NPC_PROGRESS_MULTIPLIER = 0.9;
export const CENTENNIAL_ALL_STAR_DEFAULT_GROWTH_YEARS = 15;
export const CENTENNIAL_ALL_STAR_DEFAULT_DEX_LIMIT = 1_000_000;

export const isCentennialAllStarActive = (scenarioConfig: unknown): boolean =>
    asRecord(asRecord(scenarioConfig).map).targetGeneralPool === CENTENNIAL_ALL_STAR_POOL;

export const isCentennialStatResetAllowed = (scenarioConfig: unknown): boolean =>
    !isCentennialAllStarActive(scenarioConfig);

const STAT_KEYS = ['leadership', 'strength', 'intel'] as const;
const DEX_KEYS = ['dex1', 'dex2', 'dex3', 'dex4', 'dex5'] as const;

type CentennialStatKey = (typeof STAT_KEYS)[number];
export type CentennialDexKey = (typeof DEX_KEYS)[number];

export interface CentennialAllStarTarget {
    uniqueName: string;
    generalName?: string;
    leadership: number;
    strength: number;
    intel: number;
    dex: readonly [number, number, number, number, number];
    specialDomestic?: string | null;
    [key: string]: unknown;
}

export interface CentennialAllStarPoolCandidate {
    uniqueName: string;
    name: string;
    sourceInfo: Record<string, unknown>;
}

export interface CentennialAllStarEnvironment {
    startYear: number;
    year: number;
    month: number;
}

export interface CentennialAllStarRules {
    defaultStatMin: number;
    defaultStatMax: number;
    defaultStatTotal: number;
    maxStatLevel: number;
    defaultSpecialDomestic: string | null;
    dexLimit?: number;
}

export interface CentennialAllStarScenarioConfig {
    stat: {
        min: number;
        max: number;
        total: number;
    };
    const: Record<string, unknown>;
    map: Record<string, unknown>;
}

export interface CentennialAllStarAux {
    targetId: string;
    target: CentennialAllStarTarget;
    granted: Record<CentennialStatKey | CentennialDexKey, number>;
    dexConsumed: Record<CentennialDexKey, number>;
    dexFloor: Record<CentennialDexKey, number>;
    progressMonth: number;
    milestone: number;
    naturalSpecialDomestic: string | null;
    eventSpecialDomestic: string | null;
    userInitialStats: Record<CentennialStatKey, number> | null;
    dexTargetRatio: number;
}

export interface CentennialAllStarApplyResult {
    stats: StatBlock;
    role: GeneralRole;
    meta: GeneralMeta;
    progress: number;
    milestone: number;
    previousMilestone: number;
    targetChanged: boolean;
    changed: boolean;
}

export const resolveCentennialAllStarRules = (
    config: CentennialAllStarScenarioConfig,
    fallbackSpecialDomestic: string | null = null
): CentennialAllStarRules => ({
    defaultStatMin: config.stat.min,
    defaultStatMax: config.stat.max,
    defaultStatTotal: config.stat.total,
    maxStatLevel: asNumber(config.const.maxLevel, LEGACY_DEFAULT_MAX_LEVEL),
    defaultSpecialDomestic:
        typeof config.const.defaultSpecialDomestic === 'string'
            ? config.const.defaultSpecialDomestic
            : fallbackSpecialDomestic,
    dexLimit: asNumber(config.const.dexLimit, CENTENNIAL_ALL_STAR_DEFAULT_DEX_LIMIT),
});

export const resolveCentennialNpcDexTargetRatio = (config: CentennialAllStarScenarioConfig): number => {
    const ratio = asNumber(config.map.centennialNpcDexTargetRatio, 0.4);
    if (ratio < 0 || ratio > 1) {
        throw new Error('centennialNpcDexTargetRatio must be between 0 and 1');
    }
    return ratio;
};

const emptyGranted = (): CentennialAllStarAux['granted'] => ({
    leadership: 0,
    strength: 0,
    intel: 0,
    dex1: 0,
    dex2: 0,
    dex3: 0,
    dex4: 0,
    dex5: 0,
});

const emptyDex = (): Record<CentennialDexKey, number> => ({
    dex1: 0,
    dex2: 0,
    dex3: 0,
    dex4: 0,
    dex5: 0,
});

const readFiniteNumber = (source: Record<string, unknown>, key: string, fallback = 0): number => {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return fallback;
};

const readIntegerRecord = <Key extends string>(raw: unknown, keys: readonly Key[]): Record<Key, number> => {
    const source = asRecord(raw);
    return Object.fromEntries(
        keys.map((key) => [key, Math.max(0, Math.trunc(readFiniteNumber(source, key)))])
    ) as Record<Key, number>;
};

const normalizeTarget = (raw: unknown, fallback?: CentennialAllStarTarget): CentennialAllStarTarget => {
    const source = asRecord(raw);
    const dex = Array.isArray(source.dex) ? source.dex : fallback?.dex;
    const uniqueName = typeof source.uniqueName === 'string' ? source.uniqueName : fallback?.uniqueName;
    if (!uniqueName || !dex || dex.length !== DEX_KEYS.length) {
        if (fallback) {
            return fallback;
        }
        throw new Error('100기 올스타 목표 정보가 올바르지 않습니다.');
    }
    const normalizedDex = dex.map((value) =>
        typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : Number.NaN
    );
    if (normalizedDex.some((value) => !Number.isInteger(value) || value < 0)) {
        throw new Error(`100기 올스타 숙련 목표가 올바르지 않습니다: ${uniqueName}`);
    }
    const readTargetStat = (key: CentennialStatKey): number => {
        const value = source[key] ?? fallback?.[key];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new Error(`100기 올스타 능력 목표가 올바르지 않습니다: ${uniqueName}`);
        }
        return Math.trunc(value);
    };
    return {
        ...(fallback ?? {}),
        ...source,
        uniqueName,
        leadership: readTargetStat('leadership'),
        strength: readTargetStat('strength'),
        intel: readTargetStat('intel'),
        dex: normalizedDex as [number, number, number, number, number],
        specialDomestic:
            typeof source.specialDomestic === 'string' || source.specialDomestic === null
                ? source.specialDomestic
                : (fallback?.specialDomestic ?? null),
    };
};

export const readCentennialAllStarPoolTarget = (
    candidate: CentennialAllStarPoolCandidate | null | undefined
): CentennialAllStarTarget | null => {
    if (!candidate || candidate.sourceInfo.event100Growth !== true) {
        return null;
    }
    return normalizeTarget({
        ...candidate.sourceInfo,
        uniqueName: candidate.uniqueName,
        generalName: candidate.name,
    });
};

export const initialCentennialAllStarAux = (
    target: CentennialAllStarTarget,
    rules: Pick<CentennialAllStarRules, 'defaultStatMin'>,
    userInitialStats: Record<CentennialStatKey, number> | null = null
): CentennialAllStarAux => {
    const granted = emptyGranted();
    if (userInitialStats) {
        for (const key of STAT_KEYS) {
            const initial = userInitialStats[key] ?? rules.defaultStatMin;
            granted[key] = Math.max(0, initial - Math.min(initial, rules.defaultStatMin));
        }
    }
    return {
        targetId: target.uniqueName,
        target,
        granted,
        dexConsumed: emptyDex(),
        dexFloor: emptyDex(),
        progressMonth: -1,
        milestone: 0,
        naturalSpecialDomestic: null,
        eventSpecialDomestic: null,
        userInitialStats,
        dexTargetRatio: 1,
    };
};

export const readCentennialAllStarAux = (
    meta: Record<string, unknown>,
    fallbackTarget?: CentennialAllStarTarget
): CentennialAllStarAux | null => {
    const source = asRecord(meta[CENTENNIAL_ALL_STAR_AUX_KEY]);
    if (Object.keys(source).length === 0 && !fallbackTarget) {
        return null;
    }
    const target = normalizeTarget(source.target, fallbackTarget);
    const rawInitial = asRecord(source.userInitialStats);
    const userInitialStats = Object.keys(rawInitial).length
        ? (Object.fromEntries(STAT_KEYS.map((key) => [key, Math.trunc(readFiniteNumber(rawInitial, key))])) as Record<
              CentennialStatKey,
              number
          >)
        : null;
    return {
        targetId: typeof source.targetId === 'string' ? source.targetId : target.uniqueName,
        target,
        granted: readIntegerRecord(source.granted, [...STAT_KEYS, ...DEX_KEYS]),
        dexConsumed: readIntegerRecord(source.dexConsumed, DEX_KEYS),
        dexFloor: readIntegerRecord(source.dexFloor, DEX_KEYS),
        progressMonth: Math.trunc(readFiniteNumber(source, 'progressMonth', -1)),
        milestone: Math.trunc(readFiniteNumber(source, 'milestone')),
        naturalSpecialDomestic:
            typeof source.naturalSpecialDomestic === 'string' ? source.naturalSpecialDomestic : null,
        eventSpecialDomestic: typeof source.eventSpecialDomestic === 'string' ? source.eventSpecialDomestic : null,
        userInitialStats,
        dexTargetRatio: readFiniteNumber(source, 'dexTargetRatio', 1),
    };
};

export const calculateCentennialUserInitialStats = (
    target: CentennialAllStarTarget,
    rules: Pick<CentennialAllStarRules, 'defaultStatMin' | 'defaultStatMax' | 'defaultStatTotal'>
): Record<CentennialStatKey, number> => {
    const targets = {} as Record<CentennialStatKey, number>;
    const bases = {} as Record<CentennialStatKey, number>;
    for (const key of STAT_KEYS) {
        const value = Math.min(rules.defaultStatMax, Math.max(0, Math.trunc(target[key])));
        targets[key] = value;
        bases[key] = Math.min(value, rules.defaultStatMin);
    }
    const targetTotal = STAT_KEYS.reduce((sum, key) => sum + targets[key], 0);
    const desiredTotal = Math.min(rules.defaultStatTotal, targetTotal);
    const baseTotal = STAT_KEYS.reduce((sum, key) => sum + bases[key], 0);
    const capacityTotal = targetTotal - baseTotal;
    if (capacityTotal <= 0 || desiredTotal <= baseTotal) {
        return bases;
    }

    const ratio = (desiredTotal - baseTotal) / capacityTotal;
    const result = {} as Record<CentennialStatKey, number>;
    const fractions = STAT_KEYS.map((key, order) => {
        const raw = bases[key] + (targets[key] - bases[key]) * ratio;
        result[key] = Math.floor(raw);
        return { key, fraction: raw - result[key], order };
    }).sort((left, right) => right.fraction - left.fraction || left.order - right.order);
    let remainder = desiredTotal - STAT_KEYS.reduce((sum, key) => sum + result[key], 0);
    for (const { key } of fractions) {
        if (remainder <= 0) {
            break;
        }
        if (result[key] >= targets[key]) {
            continue;
        }
        result[key] += 1;
        remainder -= 1;
    }
    return result;
};

export const calculateCentennialProgress = (
    environment: CentennialAllStarEnvironment,
    progressMultiplier = 1,
    growthYears = CENTENNIAL_ALL_STAR_DEFAULT_GROWTH_YEARS
): number => {
    if (progressMultiplier < 0 || progressMultiplier > 1) {
        throw new Error('progress multiplier must be between 0 and 1');
    }
    if (growthYears <= 0) {
        throw new Error('growthYears must be positive');
    }
    if (environment.month < 1 || environment.month > 12) {
        throw new Error('month must be between 1 and 12');
    }
    const elapsedMonths = Math.max(0, (environment.year - environment.startYear) * 12 + environment.month - 1);
    // Ref caps the common calendar progress first and applies the NPC
    // multiplier afterwards. Generated M/G generals therefore remain at a
    // permanent 90% stat target even after the fifteenth year.
    return Math.min(1, elapsedMonths / (growthYears * 12)) * progressMultiplier;
};

export const centennialStatFloor = (target: number, minimum: number, progress: number): number => {
    const normalizedProgress = Math.max(0, Math.min(1, progress));
    if (target <= minimum) {
        return target;
    }
    return Math.min(target, Math.floor(minimum + (target - minimum) * normalizedProgress));
};

export const centennialDexFloor = (target: number, progress: number): number => {
    const normalizedProgress = Math.max(0, Math.min(1, progress));
    return Math.min(target, Math.floor(target * normalizedProgress * normalizedProgress));
};

export const calculateCentennialDexTargetFloor = (
    target: number,
    environment: CentennialAllStarEnvironment,
    targetRatio = 1,
    dexLimit = CENTENNIAL_ALL_STAR_DEFAULT_DEX_LIMIT
): number => {
    if (targetRatio < 0 || targetRatio > 1) {
        throw new Error('dex target ratio must be between 0 and 1');
    }
    const capped = Math.min(dexLimit, Math.max(0, Math.trunc(target)));
    const scaled = Math.floor(capped * targetRatio);
    // Ref는 M/G장의 0.9 배율을 능력치에만 적용하고 숙련 진행률은 공통값을 쓴다.
    return centennialDexFloor(scaled, calculateCentennialProgress(environment));
};

const advance = (current: number, granted: number, floor: number): { value: number; granted: number } => {
    const delta = Math.max(0, floor - current);
    return { value: current + delta, granted: Math.max(0, granted) + delta };
};

const replaceTarget = (current: number, oldGranted: number, newFloor: number): { value: number; granted: number } => {
    const organic = Math.max(0, current - Math.max(0, oldGranted));
    const value = Math.max(organic, newFloor);
    return { value, granted: value - organic };
};

export const calculateCentennialUserCurrentTargetStats = (
    target: CentennialAllStarTarget,
    environment: CentennialAllStarEnvironment,
    rules: CentennialAllStarRules
): Record<CentennialStatKey, number> => {
    const initial = calculateCentennialUserInitialStats(target, rules);
    const progress = calculateCentennialProgress(environment);
    return Object.fromEntries(
        STAT_KEYS.map((key) => [
            key,
            Math.max(
                initial[key],
                centennialStatFloor(
                    Math.min(rules.maxStatLevel, Math.max(0, Math.trunc(target[key]))),
                    rules.defaultStatMin,
                    progress
                )
            ),
        ])
    ) as Record<CentennialStatKey, number>;
};

export const calculateCentennialLegacyUserGrant = (
    current: number,
    eventGrant: number,
    rules: Pick<CentennialAllStarRules, 'defaultStatMin' | 'defaultStatMax'>
): number => {
    const normalizedEventGrant = Math.max(0, Math.trunc(eventGrant));
    const beforeEventGrant = Math.max(0, Math.trunc(current) - normalizedEventGrant);
    const replaceableInitialGrant = Math.max(
        0,
        Math.min(beforeEventGrant, rules.defaultStatMax) - Math.min(beforeEventGrant, rules.defaultStatMin)
    );
    return normalizedEventGrant + replaceableInitialGrant;
};

/**
 * Ref's first S100 deployment did not persist userInitialStats. Before the
 * first reselection it treats the ordinary creation-range portion as an event
 * grant, so changing targets cannot preserve those points as organic growth.
 */
export const prepareCentennialLegacyUserReselection = (
    general: Pick<General, 'stats' | 'meta'>,
    rules: Pick<CentennialAllStarRules, 'defaultStatMin' | 'defaultStatMax'>
): GeneralMeta => {
    const rawAuxValue = (general.meta as Record<string, unknown>)[CENTENNIAL_ALL_STAR_AUX_KEY];
    if (!rawAuxValue || typeof rawAuxValue !== 'object' || Array.isArray(rawAuxValue)) {
        return general.meta;
    }
    const rawAux = asRecord(rawAuxValue);
    const rawInitial = rawAux.userInitialStats;
    if (rawInitial && typeof rawInitial === 'object' && !Array.isArray(rawInitial)) {
        return general.meta;
    }

    const rawGranted = asRecord(rawAux.granted);
    const granted = readIntegerRecord(rawGranted, [...STAT_KEYS, ...DEX_KEYS]);
    const currentStats: Record<CentennialStatKey, number> = {
        leadership: general.stats.leadership,
        strength: general.stats.strength,
        intel: general.stats.intelligence,
    };
    const legacyInitialStats = {} as Record<CentennialStatKey, number>;
    for (const key of STAT_KEYS) {
        const current = Math.trunc(currentStats[key]);
        const oldEventGrant = Math.max(0, Math.trunc(readFiniteNumber(rawGranted, key)));
        granted[key] = calculateCentennialLegacyUserGrant(current, granted[key], rules);
        const beforeEventGrant = Math.max(0, current - oldEventGrant);
        legacyInitialStats[key] = Math.min(beforeEventGrant, rules.defaultStatMax);
    }

    const meta: GeneralMeta = { ...general.meta };
    const mutableMeta: Record<string, unknown> = meta;
    mutableMeta[CENTENNIAL_ALL_STAR_AUX_KEY] = {
        ...rawAux,
        granted,
        userInitialStats: legacyInitialStats,
    };
    return meta;
};

export const applyCentennialAllStarTarget = (
    general: Pick<General, 'stats' | 'role' | 'meta'>,
    target: CentennialAllStarTarget,
    environment: CentennialAllStarEnvironment,
    rules: CentennialAllStarRules,
    progressMultiplier = 1,
    dexTargetRatio = 1
): CentennialAllStarApplyResult => {
    const progress = calculateCentennialProgress(environment, progressMultiplier);
    const progressMonth = Math.floor(
        Math.max(0, (environment.year - environment.startYear) * 12 + environment.month - 1) * progressMultiplier
    );
    const previousAux = readCentennialAllStarAux(general.meta as Record<string, unknown>, target);
    const aux = previousAux ?? initialCentennialAllStarAux(target, rules);
    const targetChanged = aux.targetId !== target.uniqueName;
    const granted = { ...aux.granted };
    const dexConsumed = targetChanged ? emptyDex() : { ...aux.dexConsumed };
    const dexFloor = { ...aux.dexFloor };
    const isUserTarget = aux.userInitialStats !== null;
    const nextUserInitialStats =
        targetChanged && isUserTarget ? calculateCentennialUserInitialStats(target, rules) : aux.userInitialStats;
    const dexTargetRatioChanged = aux.dexTargetRatio !== dexTargetRatio;
    const userCurrentTargetStats = isUserTarget
        ? calculateCentennialUserCurrentTargetStats(target, environment, rules)
        : null;
    const stats = { ...general.stats };
    const role = { ...general.role, items: { ...general.role.items } };
    const meta: GeneralMeta = { ...general.meta };
    const mutableMeta: Record<string, unknown> = meta;
    let changed = dexTargetRatioChanged;

    const statProperty: Record<CentennialStatKey, keyof StatBlock> = {
        leadership: 'leadership',
        strength: 'strength',
        intel: 'intelligence',
    };
    for (const key of STAT_KEYS) {
        const targetValue = Math.min(rules.maxStatLevel, Math.max(0, Math.trunc(target[key])));
        const floor = userCurrentTargetStats?.[key] ?? centennialStatFloor(targetValue, rules.defaultStatMin, progress);
        const property = statProperty[key];
        const current = stats[property];
        const result = targetChanged
            ? replaceTarget(current, granted[key], floor)
            : advance(current, granted[key], floor);
        if (result.value !== current) {
            stats[property] = result.value;
            changed = true;
        }
        granted[key] = result.granted;
    }

    for (const [index, key] of DEX_KEYS.entries()) {
        const floor = Math.max(
            0,
            calculateCentennialDexTargetFloor(
                target.dex[index]!,
                environment,
                dexTargetRatio,
                rules.dexLimit ?? CENTENNIAL_ALL_STAR_DEFAULT_DEX_LIMIT
            ) - dexConsumed[key]
        );
        dexFloor[key] = floor;
        const current = Math.trunc(readFiniteNumber(mutableMeta, key));
        const result =
            targetChanged || dexTargetRatioChanged
                ? replaceTarget(current, granted[key], floor)
                : advance(current, granted[key], floor);
        if (result.value !== current) {
            mutableMeta[key] = result.value;
            changed = true;
        }
        granted[key] = result.granted;
    }

    let naturalSpecialDomestic = aux.naturalSpecialDomestic;
    let eventSpecialDomestic = aux.eventSpecialDomestic;
    if (targetChanged && eventSpecialDomestic !== null && role.specialDomestic === eventSpecialDomestic) {
        role.specialDomestic = naturalSpecialDomestic ?? rules.defaultSpecialDomestic;
        eventSpecialDomestic = null;
        changed = true;
    }
    const targetSpecial = target.specialDomestic;
    if (
        progress >= CENTENNIAL_ALL_STAR_TRAIT_UNLOCK_PROGRESS &&
        typeof targetSpecial === 'string' &&
        targetSpecial !== ''
    ) {
        if (naturalSpecialDomestic === null) {
            naturalSpecialDomestic = role.specialDomestic;
        }
        if (role.specialDomestic !== targetSpecial) {
            role.specialDomestic = targetSpecial;
            changed = true;
        }
        eventSpecialDomestic = targetSpecial;
    }

    const previousMilestone = aux.milestone;
    const milestone = Math.min(5, Math.floor(progress * 5 + 0.0000001));
    const nextAux: CentennialAllStarAux = {
        ...aux,
        targetId: target.uniqueName,
        target,
        granted,
        dexConsumed,
        dexFloor,
        progressMonth: Math.max(aux.progressMonth, progressMonth),
        milestone: Math.max(previousMilestone, milestone),
        naturalSpecialDomestic,
        eventSpecialDomestic,
        userInitialStats: nextUserInitialStats,
        dexTargetRatio,
    };
    mutableMeta[CENTENNIAL_ALL_STAR_AUX_KEY] = nextAux;

    return {
        stats,
        role,
        meta,
        progress,
        milestone,
        previousMilestone,
        targetChanged,
        changed: changed || targetChanged || milestone > previousMilestone,
    };
};

export const calculateCentennialGeneratedNpcInitialStats = (
    target: CentennialAllStarTarget,
    generated: StatBlock
): StatBlock => {
    const keyOrder = Object.fromEntries(STAT_KEYS.map((key, index) => [key, index])) as Record<
        CentennialStatKey,
        number
    >;
    const targetOrder = [...STAT_KEYS].sort(
        (left, right) => target[right] - target[left] || keyOrder[left] - keyOrder[right]
    );
    const generatedValues = [generated.leadership, generated.strength, generated.intelligence].sort(
        (left, right) => right - left
    );
    const values = Object.fromEntries(targetOrder.map((key, index) => [key, generatedValues[index]!])) as Record<
        CentennialStatKey,
        number
    >;
    return {
        leadership: values.leadership,
        strength: values.strength,
        intelligence: values.intel,
    };
};

export const initializeCentennialGeneratedNpc = (
    general: Pick<General, 'stats' | 'role' | 'meta'>,
    target: CentennialAllStarTarget,
    rules: CentennialAllStarRules
): Pick<CentennialAllStarApplyResult, 'stats' | 'role' | 'meta'> => {
    const meta: GeneralMeta = { ...general.meta };
    const mutableMeta: Record<string, unknown> = meta;
    Object.assign(mutableMeta, {
        dex1: 0,
        dex2: 0,
        dex3: 0,
        dex4: 0,
        dex5: 0,
        [CENTENNIAL_ALL_STAR_AUX_KEY]: initialCentennialAllStarAux(target, rules),
    });
    return {
        stats: calculateCentennialGeneratedNpcInitialStats(target, general.stats),
        role: { ...general.role, items: { ...general.role.items } },
        meta,
    };
};

export const reconcileCentennialDexConversion = (
    metaInput: GeneralMeta,
    sourceKey: CentennialDexKey,
    destinationKey: CentennialDexKey,
    sourceBefore: number,
    sourceAfter: number,
    destinationBefore: number,
    destinationAfter: number,
    convertCoefficient: number
): GeneralMeta => {
    if (!DEX_KEYS.includes(sourceKey) || !DEX_KEYS.includes(destinationKey) || sourceKey === destinationKey) {
        throw new Error('invalid dex conversion keys');
    }
    if (convertCoefficient < 0 || convertCoefficient > 1) {
        throw new Error('dex conversion coefficient must be between 0 and 1');
    }
    const sourceDecrease = Math.max(0, sourceBefore - sourceAfter);
    const destinationIncrease = Math.max(0, destinationAfter - destinationBefore);
    if (sourceDecrease === 0 && destinationIncrease === 0) {
        return metaInput;
    }
    const aux = readCentennialAllStarAux(metaInput as Record<string, unknown>);
    if (!aux) {
        return metaInput;
    }
    const granted = { ...aux.granted };
    const dexConsumed = { ...aux.dexConsumed };
    const sourceGrantedBefore = Math.min(Math.max(0, sourceBefore), Math.max(0, granted[sourceKey]));
    const eventGrantRemoved = sourceBefore > 0 ? Math.trunc((sourceDecrease * sourceGrantedBefore) / sourceBefore) : 0;
    const sourceGrantedAfter = Math.max(0, sourceGrantedBefore - eventGrantRemoved);
    const destinationGrantedBefore = Math.min(Math.max(0, destinationBefore), Math.max(0, granted[destinationKey]));
    let eventGrantTransferred =
        sourceBefore > 0 ? Math.trunc((destinationIncrease * sourceGrantedBefore) / sourceBefore) : 0;
    eventGrantTransferred = Math.min(destinationIncrease, eventGrantRemoved, eventGrantTransferred);
    granted[sourceKey] = sourceGrantedAfter;
    granted[destinationKey] = Math.min(Math.max(0, destinationAfter), destinationGrantedBefore + eventGrantTransferred);

    const sourceFloor = Math.max(0, aux.dexFloor[sourceKey] ?? sourceBefore);
    const gapBefore = Math.max(0, sourceFloor - sourceBefore);
    const gapAfter = Math.max(0, sourceFloor - sourceAfter);
    dexConsumed[sourceKey] = Math.max(0, dexConsumed[sourceKey] + Math.max(0, gapAfter - gapBefore));
    const meta: GeneralMeta = { ...metaInput };
    const mutableMeta: Record<string, unknown> = meta;
    mutableMeta[CENTENNIAL_ALL_STAR_AUX_KEY] = {
        ...aux,
        granted,
        dexConsumed,
    };
    return meta;
};

export const centennialRecordableValue = (current: number, granted: number): number =>
    Math.max(0, current - Math.max(0, granted));

/**
 * Ref CentennialAllStarGrowthService::recordableRawValue. Event-provided
 * mastery is useful during the season, but must not enter permanent ranking,
 * Hall of Fame, or inheritance records.
 */
export const readCentennialRecordableDexterity = (meta: Record<string, unknown>, key: CentennialDexKey): number => {
    const current = asNumber(meta[key], 0);
    const granted = asNumber(asRecord(asRecord(meta[CENTENNIAL_ALL_STAR_AUX_KEY]).granted)[key], 0);
    return centennialRecordableValue(current, granted);
};
