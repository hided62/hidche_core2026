import { GENERAL_TURN_COMMAND_KEYS, isGeneralTurnCommandKey, type GeneralTurnCommandKey } from './general/index.js';
import { NATION_TURN_COMMAND_KEYS, isNationTurnCommandKey, type NationTurnCommandKey } from './nation/index.js';

export interface TurnCommandProfile {
    general: GeneralTurnCommandKey[];
    nation: NationTurnCommandKey[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

const asStringArray = (value: unknown): string[] | null => {
    if (!Array.isArray(value)) {
        return null;
    }
    const list = value.filter((entry): entry is string => typeof entry === 'string');
    return list.length > 0 ? list : null;
};

const parseKeyList = <T extends string>(options: {
    raw: unknown;
    defaults: T[];
    isKey: (value: string) => value is T;
    label: string;
}): T[] => {
    const rawList = asStringArray(options.raw);
    if (!rawList) {
        return options.defaults;
    }
    const parsed: T[] = [];
    for (const value of rawList) {
        if (!options.isKey(value)) {
            throw new Error(`Unknown ${options.label} command key: ${value}`);
        }
        parsed.push(value);
    }
    return parsed;
};

export const DEFAULT_TURN_COMMAND_PROFILE: TurnCommandProfile = {
    general: [...GENERAL_TURN_COMMAND_KEYS],
    nation: [...NATION_TURN_COMMAND_KEYS],
};

export const parseTurnCommandProfile = (
    raw: unknown,
    fallback: TurnCommandProfile = DEFAULT_TURN_COMMAND_PROFILE
): TurnCommandProfile => {
    if (!isRecord(raw)) {
        return fallback;
    }
    return {
        general: parseKeyList({
            raw: raw.general,
            defaults: fallback.general,
            isKey: isGeneralTurnCommandKey,
            label: 'general',
        }),
        nation: parseKeyList({
            raw: raw.nation,
            defaults: fallback.nation,
            isKey: isNationTurnCommandKey,
            label: 'nation',
        }),
    };
};
