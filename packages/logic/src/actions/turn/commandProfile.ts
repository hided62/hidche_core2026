import { GENERAL_TURN_COMMAND_KEYS, isGeneralTurnCommandKey, type GeneralTurnCommandKey } from './general/index.js';
import { NATION_TURN_COMMAND_KEYS, isNationTurnCommandKey, type NationTurnCommandKey } from './nation/index.js';
import { asStringArray, isRecord } from '@sammo-ts/common';
import { TurnCommandProfileInputSchema } from '../../resources/turnCommandSchema.js';

export interface TurnCommandProfile {
    general: GeneralTurnCommandKey[];
    nation: NationTurnCommandKey[];
}

export interface TurnCommandGroup<Key extends string> {
    category: string;
    commands: Key[];
}

export interface ScenarioTurnCommandProfileResolution {
    profile: TurnCommandProfile;
    generalGroups: Array<TurnCommandGroup<GeneralTurnCommandKey>> | null;
    nationGroups: Array<TurnCommandGroup<NationTurnCommandKey>> | null;
}

const parseKeyList = <T extends string>(options: {
    raw: unknown;
    isKey: (value: string) => value is T;
    label: string;
}): T[] => {
    if (!Array.isArray(options.raw) || options.raw.length === 0) {
        throw new Error(`${options.label} command profile must be a non-empty array.`);
    }
    const parsed: T[] = [];
    const seen = new Set<T>();
    for (const value of asStringArray(options.raw)) {
        if (!options.isKey(value)) {
            throw new Error(`Unknown ${options.label} command key: ${value}`);
        }
        if (seen.has(value)) {
            throw new Error(`Duplicate ${options.label} command key: ${value}`);
        }
        seen.add(value);
        parsed.push(value);
    }
    if (parsed.length !== options.raw.length) {
        throw new Error(`${options.label} command profile contains a non-string key.`);
    }
    if (!parsed.includes('휴식' as T)) {
        throw new Error(`${options.label} command profile must include 휴식.`);
    }
    return parsed;
};

export const DEFAULT_TURN_COMMAND_PROFILE: TurnCommandProfile = {
    general: [...GENERAL_TURN_COMMAND_KEYS],
    nation: [...NATION_TURN_COMMAND_KEYS],
};

export const parseTurnCommandProfile = (raw: unknown): TurnCommandProfile => {
    const parsed = TurnCommandProfileInputSchema.safeParse(raw);
    if (!parsed.success) {
        throw new Error(`Invalid turn command profile: ${parsed.error.message}`);
    }
    const data = parsed.data;
    return {
        general: parseKeyList({
            raw: data.general,
            isKey: isGeneralTurnCommandKey,
            label: 'general',
        }),
        nation: parseKeyList({
            raw: data.nation,
            isKey: isNationTurnCommandKey,
            label: 'nation',
        }),
    };
};

const parseScenarioCommandGroups = <Key extends string>(options: {
    raw: unknown;
    isKey: (value: string) => value is Key;
    label: string;
}): Array<TurnCommandGroup<Key>> | null => {
    if (options.raw === undefined || options.raw === null) {
        return null;
    }
    if (!isRecord(options.raw)) {
        throw new Error(`Scenario ${options.label} command groups must be an object.`);
    }

    const groups: Array<TurnCommandGroup<Key>> = [];
    const seen = new Set<Key>();
    for (const [category, rawCommands] of Object.entries(options.raw)) {
        if (!category.trim()) {
            throw new Error(`Scenario ${options.label} command category must be non-empty.`);
        }
        if (!Array.isArray(rawCommands)) {
            throw new Error(`Scenario ${options.label} command category ${category} must be an array.`);
        }
        const commands: Key[] = [];
        for (const value of asStringArray(rawCommands)) {
            if (!options.isKey(value)) {
                throw new Error(`Unknown scenario ${options.label} command key: ${value}`);
            }
            if (seen.has(value)) {
                throw new Error(`Duplicate scenario ${options.label} command key: ${value}`);
            }
            seen.add(value);
            commands.push(value);
        }
        if (commands.length !== rawCommands.length) {
            throw new Error(`Scenario ${options.label} command category ${category} contains a non-string key.`);
        }
        groups.push({ category, commands });
    }

    const flattened = groups.flatMap((group) => group.commands);
    if (!flattened.includes('휴식' as Key)) {
        throw new Error(`Scenario ${options.label} command groups must include 휴식.`);
    }
    return groups;
};

/**
 * Ref replaces GameConst::$availableGeneralCommand/$availableChiefCommand with
 * the scenario const when present. Resolve that same public/executable profile
 * here so the API and daemon cannot silently use the default profile instead.
 */
export const resolveScenarioTurnCommandProfile = (
    scenarioConst: unknown,
    fallback: TurnCommandProfile
): ScenarioTurnCommandProfileResolution => {
    if (scenarioConst !== undefined && scenarioConst !== null && !isRecord(scenarioConst)) {
        throw new Error('Scenario const must be an object.');
    }
    const config = isRecord(scenarioConst) ? scenarioConst : {};
    const generalGroups = parseScenarioCommandGroups({
        raw: config.availableGeneralCommand,
        isKey: isGeneralTurnCommandKey,
        label: 'general',
    });
    const nationGroups = parseScenarioCommandGroups({
        raw: config.availableChiefCommand,
        isKey: isNationTurnCommandKey,
        label: 'nation',
    });

    return {
        profile: {
            general: generalGroups ? generalGroups.flatMap((group) => group.commands) : [...fallback.general],
            nation: nationGroups ? nationGroups.flatMap((group) => group.commands) : [...fallback.nation],
        },
        generalGroups,
        nationGroups,
    };
};
