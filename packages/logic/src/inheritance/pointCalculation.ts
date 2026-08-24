import { readCentennialRecordableDexterity, type CentennialDexKey } from '../scenario/centennialAllStar.js';

export const LEGACY_DEX_INHERITANCE_LIMIT = 1_275_975;

export const ALL_MERGED_INHERITANCE_KEYS = [
    'lived_month',
    'max_domestic_critical',
    'active_action',
    'unifier',
    'tournament',
    'max_belong',
    'combat',
    'sabotage',
    'dex',
    'betting',
] as const;

export type MergedInheritanceKey = (typeof ALL_MERGED_INHERITANCE_KEYS)[number];

export interface InheritancePointGeneral {
    meta: Record<string, unknown>;
    inheritancePoints?: Record<string, number>;
}

/**
 * Ref InheritancePointType::rebirthStoreCoeff. A null coefficient means that
 * the point is not paid on rebirth and remains reserved for the final death or
 * unification settlement.
 */
export const REBIRTH_INHERITANCE_COEFFICIENTS: Readonly<Record<MergedInheritanceKey, number | null>> = {
    lived_month: 1,
    max_domestic_critical: null,
    active_action: 1,
    unifier: null,
    tournament: 1,
    max_belong: null,
    combat: 1,
    sabotage: 1,
    dex: 0.5,
    betting: 1,
};

const readNumber = (source: Record<string, unknown>, ...keys: string[]): number => {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string') {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) return parsed;
        }
    }
    return 0;
};

const readStoredPoint = (
    general: InheritancePointGeneral,
    key: MergedInheritanceKey,
    storedOverride?: number
): number => storedOverride ?? general.inheritancePoints?.[key] ?? 0;

export const computeDexInheritancePoint = (general: InheritancePointGeneral): number => {
    let totalDexterity = 0;
    for (let index = 1; index <= 5; index += 1) {
        let dexterity = readCentennialRecordableDexterity(general.meta, `dex${index}` as CentennialDexKey);
        if (dexterity > LEGACY_DEX_INHERITANCE_LIMIT) {
            totalDexterity += (dexterity - LEGACY_DEX_INHERITANCE_LIMIT) / 3;
            dexterity = LEGACY_DEX_INHERITANCE_LIMIT;
        }
        totalDexterity += dexterity;
    }
    return totalDexterity * 0.001;
};

export const computeBettingInheritancePoint = (general: InheritancePointGeneral): number => {
    const wins = readNumber(general.meta, 'betwin', 'rank_betwin');
    const gold = readNumber(general.meta, 'betgold', 'rank_betgold');
    const wonGold = readNumber(general.meta, 'betwingold', 'rank_betwingold');
    const winRate = wonGold / Math.max(1000, gold);
    return wins * 10 * winRate ** 2;
};

export const computeActiveInheritancePoint = (
    general: InheritancePointGeneral,
    key: MergedInheritanceKey,
    storedOverride?: number
): number => {
    const stored = readStoredPoint(general, key, storedOverride);
    switch (key) {
        case 'lived_month': {
            const value = readNumber(general.meta, 'inherit_lived_month');
            return value !== 0 ? value : stored;
        }
        case 'max_domestic_critical':
            // Ref keeps the current streak in general.aux and the lifetime max
            // in inheritance storage. Math.max also upgrades pre-fix live
            // snapshots whose current streak has not yet been copied there.
            return Math.max(
                stored,
                readNumber(general.meta, 'max_domestic_critical'),
                readNumber(general.meta, 'inherit_max_domestic_critical')
            );
        case 'active_action': {
            const value = readNumber(general.meta, 'inherit_active_action');
            return value !== 0 ? value * 3 : stored;
        }
        case 'unifier':
        case 'tournament':
            return stored;
        case 'max_belong':
            return (
                Math.max(
                    readNumber(general.meta, 'belong'),
                    readNumber(general.meta, 'max_belong'),
                    readNumber(general.meta, 'inherit_max_belong')
                ) * 10
            );
        case 'combat':
            return readNumber(general.meta, 'rank_warnum', 'warnum') * 5;
        case 'sabotage':
            return readNumber(general.meta, 'firenum', 'rank_firenum') * 20;
        case 'dex':
            return computeDexInheritancePoint(general);
        case 'betting':
            return computeBettingInheritancePoint(general);
    }
};

export interface InheritanceSettlementBreakdown {
    earned: Record<MergedInheritanceKey, number>;
    retained: Partial<Record<MergedInheritanceKey, number>>;
    totalEarned: number;
}

export const computeInheritanceSettlementBreakdown = (
    general: InheritancePointGeneral,
    isRebirth: boolean
): InheritanceSettlementBreakdown => {
    const earned = {} as Record<MergedInheritanceKey, number>;
    const retained: Partial<Record<MergedInheritanceKey, number>> = {};
    let totalEarned = 0;

    for (const key of ALL_MERGED_INHERITANCE_KEYS) {
        const value = computeActiveInheritancePoint(general, key);
        const rebirthCoefficient = REBIRTH_INHERITANCE_COEFFICIENTS[key];
        if (isRebirth && rebirthCoefficient === null) {
            earned[key] = 0;
            retained[key] = value;
            continue;
        }
        const settledValue = value * (isRebirth ? (rebirthCoefficient ?? 0) : 1);
        earned[key] = settledValue;
        totalEarned += settledValue;
    }

    return { earned, retained, totalEarned };
};
