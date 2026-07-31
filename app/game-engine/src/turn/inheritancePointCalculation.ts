import type { TurnGeneral } from './types.js';

const DEX_LIMIT = 1_275_975;

export const STORED_INHERITANCE_KEYS = [
    'lived_month',
    'max_domestic_critical',
    'active_action',
    'unifier',
    'tournament',
] as const;

export const ALL_MERGED_INHERITANCE_KEYS = [
    ...STORED_INHERITANCE_KEYS,
    'max_belong',
    'combat',
    'sabotage',
    'dex',
    'betting',
] as const;

export type MergedInheritanceKey = (typeof ALL_MERGED_INHERITANCE_KEYS)[number];

const readNumber = (source: Record<string, unknown>, key: string): number => {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
};

const computeDexPoint = (general: TurnGeneral): number => {
    let totalDexterity = 0;
    for (let index = 1; index <= 5; index += 1) {
        let dexterity = readNumber(general.meta, `dex${index}`);
        if (dexterity > DEX_LIMIT) {
            totalDexterity += (dexterity - DEX_LIMIT) / 3;
            dexterity = DEX_LIMIT;
        }
        totalDexterity += dexterity;
    }
    return totalDexterity * 0.001;
};

const computeBettingPoint = (general: TurnGeneral): number => {
    const wins = readNumber(general.meta, 'betwin');
    const gold = readNumber(general.meta, 'betgold');
    const wonGold = readNumber(general.meta, 'betwingold');
    const winRate = wonGold / Math.max(1000, gold);
    return wins * 10 * winRate ** 2;
};

export const computeActiveInheritancePoint = (
    general: TurnGeneral,
    key: MergedInheritanceKey,
    storedOverride?: number
): number => {
    const stored = storedOverride ?? general.inheritancePoints?.[key] ?? 0;
    switch (key) {
        case 'lived_month': {
            const value = readNumber(general.meta, 'inherit_lived_month');
            return value !== 0 ? value : stored;
        }
        case 'max_domestic_critical': {
            const value = readNumber(general.meta, 'max_domestic_critical');
            return value !== 0 ? value : stored;
        }
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
            return readNumber(general.meta, 'rank_warnum') * 5;
        case 'sabotage':
            return readNumber(general.meta, 'firenum') * 20;
        case 'dex':
            return computeDexPoint(general);
        case 'betting':
            return computeBettingPoint(general);
    }
};
