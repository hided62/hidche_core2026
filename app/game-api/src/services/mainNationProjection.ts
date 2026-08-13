import { asRecord } from '@sammo-ts/common';

const STRATEGIC_COMMAND_NAMES = [
    '필사즉생',
    '백성동원',
    '수몰',
    '허보',
    '의병모집',
    '이호경식',
    '급습',
    '피장파장',
] as const;

const readFiniteNumber = (value: unknown, fallback = 0): number => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const splitNationTraitInfo = (info: string): { pros: string; cons: string } => {
    const tokens = info.trim().split(/\s+/u).filter(Boolean);
    return {
        pros: tokens.filter((token) => token.endsWith('↑')).join(' '),
        cons: tokens.filter((token) => token.endsWith('↓')).join(' '),
    };
};

export const resolveMainNationTech = (options: {
    tech: number;
    currentYear: number;
    worldConfig: unknown;
    worldMeta: unknown;
}): { level: number; limited: boolean } => {
    const config = asRecord(options.worldConfig);
    const constValues = asRecord(config.const ?? config.consts);
    const scenarioMeta = asRecord(asRecord(options.worldMeta).scenarioMeta);
    const maxLevel = Math.max(1, Math.floor(readFiniteNumber(constValues.maxTechLevel, 12)));
    const initialLevel = Math.max(1, Math.floor(readFiniteNumber(constValues.initialAllowedTechLevel, 1)));
    const increaseYears = Math.max(1, Math.floor(readFiniteNumber(constValues.techLevelIncYear, 5)));
    const startYear = readFiniteNumber(scenarioMeta.startYear, options.currentYear);
    const relativeMaximum = clamp(
        Math.floor((options.currentYear - startYear) / increaseYears) + initialLevel,
        1,
        maxLevel
    );
    const level = clamp(Math.floor(options.tech / 1000), 0, maxLevel);
    return { level, limited: level >= relativeMaximum };
};

export const resolveImpossibleStrategicCommands = (
    nationMeta: unknown,
    currentYear: number,
    currentMonth: number
): Array<{ name: string; remainingTurns: number; availableYear: number; availableMonth: number }> => {
    const meta = asRecord(nationMeta);
    const currentYearMonth = Math.floor(currentYear) * 12 + Math.floor(currentMonth) - 1;
    const result: Array<{ name: string; remainingTurns: number; availableYear: number; availableMonth: number }> = [];

    for (const name of STRATEGIC_COMMAND_NAMES) {
        const nextAvailable = Math.floor(readFiniteNumber(meta[`next_execute_${name}`], 0));
        if (nextAvailable <= currentYearMonth) continue;
        result.push({
            name,
            remainingTurns: nextAvailable - currentYearMonth,
            availableYear: Math.floor(nextAvailable / 12),
            availableMonth: (nextAvailable % 12) + 1,
        });
    }
    return result;
};
