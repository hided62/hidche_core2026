import { JosaUtil, LiteHashDRBG, RandUtil, asRecord } from '@sammo-ts/common';
import {
    DOMESTIC_TRAIT_KEYS,
    LogCategory,
    LogFormat,
    LogScope,
    PERSONALITY_TRAIT_KEYS,
    WAR_TRAIT_KEYS,
    type TurnCommandEnv,
} from '@sammo-ts/logic';
import { simpleSerialize } from '@sammo-ts/logic/war/utils.js';

import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import type { MonthlyEventActionHandler } from './monthlyEventHandler.js';
import type { InMemoryReservedTurnStore } from './reservedTurnStore.js';
import type { TurnGeneral } from './types.js';

type RegisterNpcActionName = 'RegNPC' | 'RegNeutralNPC';

interface RegisterNpcArguments {
    affinity: number;
    name: string;
    picture: number | string | null;
    nationId: number;
    city: number | string | null;
    leadership: number;
    strength: number;
    intelligence: number;
    officerLevel: number | null;
    birthYear: number;
    deathYear: number;
    personality: string | null;
    special: string | null;
    text: string;
}

const ADULT_AGE = 14;

const readInteger = (value: unknown, label: string, fallback?: number): number => {
    if (value === undefined && fallback !== undefined) {
        return fallback;
    }
    const parsed =
        typeof value === 'number'
            ? value
            : typeof value === 'string' && value.trim() !== ''
              ? Number(value)
              : Number.NaN;
    if (!Number.isInteger(parsed)) {
        throw new Error(`${label} must be an integer.`);
    }
    return parsed;
};

const readName = (value: unknown): string => {
    if (typeof value !== 'string') {
        throw new Error('NPC name must be a string.');
    }
    return value;
};

const readNullableString = (value: unknown, label: string): string | null => {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value !== 'string') {
        throw new Error(`${label} must be a string or null.`);
    }
    return value;
};

const readPicture = (value: unknown): number | string | null => {
    if (value === null || value === undefined || typeof value === 'number' || typeof value === 'string') {
        return value ?? null;
    }
    throw new Error('NPC picture must be a number, string, or null.');
};

const readCity = (value: unknown): number | string | null => {
    if (value === null || value === undefined || typeof value === 'number' || typeof value === 'string') {
        return value ?? null;
    }
    throw new Error('NPC city must be a number, string, or null.');
};

const parseArguments = (actionName: RegisterNpcActionName, args: readonly unknown[]): RegisterNpcArguments => {
    if (actionName === 'RegNPC') {
        return {
            affinity: readInteger(args[0], 'RegNPC affinity'),
            name: readName(args[1]),
            picture: readPicture(args[2]),
            nationId: readInteger(args[3], 'RegNPC nationId'),
            city: readCity(args[4]),
            leadership: readInteger(args[5], 'RegNPC leadership'),
            strength: readInteger(args[6], 'RegNPC strength'),
            intelligence: readInteger(args[7], 'RegNPC intelligence'),
            officerLevel: readInteger(args[8], 'RegNPC officerLevel'),
            birthYear: readInteger(args[9], 'RegNPC birthYear', 160),
            deathYear: readInteger(args[10], 'RegNPC deathYear', 300),
            personality: readNullableString(args[11], 'RegNPC personality'),
            special: readNullableString(args[12], 'RegNPC special'),
            text: readNullableString(args[13], 'RegNPC text') || '',
        };
    }
    return {
        affinity: readInteger(args[0], 'RegNeutralNPC affinity'),
        name: readName(args[1]),
        picture: readPicture(args[2]),
        nationId: readInteger(args[3], 'RegNeutralNPC nationId'),
        city: readCity(args[4]),
        leadership: readInteger(args[5], 'RegNeutralNPC leadership'),
        strength: readInteger(args[6], 'RegNeutralNPC strength'),
        intelligence: readInteger(args[7], 'RegNeutralNPC intelligence'),
        officerLevel: null,
        birthYear: readInteger(args[8], 'RegNeutralNPC birthYear', 160),
        deathYear: readInteger(args[9], 'RegNeutralNPC deathYear', 300),
        personality: readNullableString(args[10], 'RegNeutralNPC personality'),
        special: readNullableString(args[11], 'RegNeutralNPC special'),
        text: readNullableString(args[12], 'RegNeutralNPC text') || '',
    };
};

const resolveHiddenSeed = (world: InMemoryTurnWorld): string | number => {
    const state = world.getState();
    const value = state.meta.hiddenSeed ?? state.meta.seed ?? state.id;
    return typeof value === 'string' || typeof value === 'number' ? value : String(value);
};

const resolvePersonality = (raw: string | null): string | null => {
    if (raw === null) {
        return null;
    }
    const key = raw.startsWith('che_') ? raw : `che_${raw}`;
    if (!PERSONALITY_TRAIT_KEYS.includes(key as (typeof PERSONALITY_TRAIT_KEYS)[number])) {
        throw new Error(`Unknown NPC personality: ${raw}`);
    }
    return key;
};

const resolveSpecial = (
    raw: string | null,
    env: TurnCommandEnv
): { specialDomestic: string | null; specialWar: string | null } => {
    if (raw === null || raw === '' || raw === 'None') {
        return {
            specialDomestic: env.defaultSpecialDomestic,
            specialWar: env.defaultSpecialWar,
        };
    }
    const key = raw.startsWith('che_') ? raw : `che_${raw}`;
    if (DOMESTIC_TRAIT_KEYS.includes(key as (typeof DOMESTIC_TRAIT_KEYS)[number])) {
        return { specialDomestic: key, specialWar: env.defaultSpecialWar };
    }
    if (WAR_TRAIT_KEYS.includes(key as (typeof WAR_TRAIT_KEYS)[number])) {
        return { specialDomestic: env.defaultSpecialDomestic, specialWar: key };
    }
    throw new Error(`Unknown NPC speciality: ${raw}`);
};

const resolveCityId = (world: InMemoryTurnWorld, raw: number | string | null): number | null => {
    if (raw === null) {
        return null;
    }
    const city =
        typeof raw === 'number'
            ? world.getCityById(raw)
            : world.listCities().find((candidate) => candidate.name === raw) ?? null;
    if (!city) {
        throw new Error(`Unknown NPC city: ${String(raw)}`);
    }
    return city.id;
};

const resolvePicture = (
    raw: number | string | null,
    showImgLevel: number,
    iconPath: string
): string => {
    if (showImgLevel < 3 || raw === null || (typeof raw === 'number' && raw < 0)) {
        return 'default.jpg';
    }
    if (typeof raw === 'number') {
        return `${raw}.jpg`;
    }
    if (iconPath !== '' && iconPath !== '.' && !raw.includes('/')) {
        return `${iconPath}/${raw}`;
    }
    return raw;
};

const buildSpecialityAge = (
    retirementYear: number,
    age: number,
    relativeYear: number,
    divisor: number
): number => Math.max(Math.round((retirementYear - age) / divisor - relativeYear / 2), 3) + age;

const resolveRuntimeNumber = (
    source: Record<string, unknown> | undefined,
    key: string,
    fallback: number
): number => {
    const value = source?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

export const createRegisterNpcHandler = (options: {
    actionName: RegisterNpcActionName;
    getWorld: () => InMemoryTurnWorld | null;
    reservedTurns: InMemoryReservedTurnStore;
    env: TurnCommandEnv;
    worldConfig?: Record<string, unknown>;
    scenarioFiction?: number | null;
}): MonthlyEventActionHandler => {
    const npcType = options.actionName === 'RegNPC' ? 2 : 6;
    const namePrefix = npcType === 2 ? 'ⓝ' : 'ⓤ';

    return (args, environment) => {
        const world = options.getWorld();
        if (!world) {
            return;
        }
        const parsed = parseArguments(options.actionName, args);
        const explicitCityId = resolveCityId(world, parsed.city);
        const explicitPersonality = resolvePersonality(parsed.personality);
        const special = resolveSpecial(parsed.special, options.env);
        const rng = new RandUtil(
            new LiteHashDRBG(
                simpleSerialize(
                    resolveHiddenSeed(world),
                    options.actionName,
                    parsed.name,
                    parsed.nationId,
                    parsed.leadership,
                    parsed.strength,
                    parsed.intelligence
                )
            )
        );

        const affinity =
            parsed.affinity < 1
                ? rng.nextRangeInt(1, 150)
                : parsed.affinity >= 900
                  ? 999
                  : parsed.affinity <= 150
                    ? parsed.affinity
                    : null;
        if (affinity === null) {
            throw new Error(`Invalid NPC affinity: ${parsed.affinity}`);
        }

        const configValues = asRecord(world.getScenarioConfig().const);
        const retirementYear = resolveRuntimeNumber(configValues, 'retirementYear', 80);
        const age = environment.year - parsed.birthYear;
        const relativeYear = Math.max(environment.year - environment.startyear, 0);
        const specAge = buildSpecialityAge(retirementYear, age, relativeYear, 12);
        const specAge2 = buildSpecialityAge(retirementYear, age, relativeYear, 6);
        const personality =
            explicitPersonality ?? rng.choice(options.env.availablePersonalities ?? ['che_안전']);

        if (parsed.deathYear <= environment.year || age < ADULT_AGE) {
            return;
        }

        const isNewGeneral = age === ADULT_AGE;
        const fiction = resolveRuntimeNumber(
            options.worldConfig,
            'fiction',
            options.scenarioFiction ?? 0
        );
        let nationId = parsed.nationId;
        if ((fiction !== 0 && isNewGeneral) || !world.getNationById(nationId)) {
            nationId = 0;
        }
        const initialOfficerLevel =
            parsed.officerLevel === null ? (parsed.nationId !== 0 ? 1 : 0) : parsed.officerLevel;
        const officerLevel = !initialOfficerLevel || isNewGeneral ? (nationId !== 0 ? 1 : 0) : initialOfficerLevel;
        const name = `${namePrefix}${parsed.name}`;

        if (isNewGeneral) {
            const josaYi = JosaUtil.pick(name, '이');
            world.pushLog({
                scope: LogScope.SYSTEM,
                category: LogCategory.ACTION,
                text: `<Y>${name}</>${josaYi} 성인이 되어 <S>등장</>했습니다.`,
                format: LogFormat.MONTH,
                year: environment.year,
                month: environment.month,
            });
        }

        let cityId = explicitCityId;
        if (cityId === null) {
            const nationCities =
                nationId === 0 ? [] : world.listCities().filter((city) => city.nationId === nationId);
            const candidates = nationCities.length > 0 ? nationCities : world.listCities();
            if (candidates.length === 0) {
                throw new Error(`${options.actionName} requires at least one city.`);
            }
            cityId = rng.choice(candidates).id;
        }

        const turnMinutes = world.getState().tickSeconds / 60;
        if (!(turnMinutes > 0) || !Number.isInteger(turnMinutes)) {
            throw new Error(`${options.actionName} requires a positive integer turn term.`);
        }
        const turnSecond = rng.nextRangeInt(0, 60 * turnMinutes - 1);
        const turnFraction = rng.nextRangeInt(0, 999_999);
        const turnTime = new Date(
            environment.turnTime.getTime() + turnSecond * 1_000 + Math.floor(turnFraction / 1_000)
        );
        const killturn =
            (parsed.deathYear - environment.year) * 12 +
            rng.nextRangeInt(0, 11) +
            environment.month -
            1;
        const id = world.getNextGeneralId();
        const showImgLevel = resolveRuntimeNumber(options.worldConfig, 'showImgLevel', 3);
        const general: TurnGeneral = {
            id,
            userId: null,
            name,
            nationId,
            cityId,
            troopId: 0,
            stats: {
                leadership: parsed.leadership,
                strength: parsed.strength,
                intelligence: parsed.intelligence,
            },
            experience: age * 100,
            dedication: age * 100,
            officerLevel,
            role: {
                personality,
                ...special,
                items: { horse: null, weapon: null, book: null, item: null },
            },
            injury: 0,
            gold: 1_000,
            rice: 1_000,
            crew: 0,
            crewTypeId: options.env.defaultCrewTypeId,
            train: 0,
            atmos: 0,
            age,
            npcState: npcType,
            bornYear: parsed.birthYear,
            deadYear: parsed.deathYear,
            affinity,
            picture: resolvePicture(parsed.picture, showImgLevel, world.getScenarioConfig().iconPath),
            triggerState: {
                flags: {},
                counters: {},
                modifiers: {},
                meta: {},
            },
            lastTurn: { command: '휴식' },
            turnTime,
            recentWarTime: null,
            meta: {
                killturn,
                npcType,
                npc_org: npcType,
                belong: 0,
                dedlevel: 1,
                specage: specAge,
                specage2: specAge2,
                dex1: 0,
                dex2: 0,
                dex3: 0,
                dex4: 0,
                dex5: 0,
                text: parsed.text,
            },
        };
        if (!world.addGeneral(general)) {
            throw new Error(`${options.actionName} generated a duplicate general id: ${id}`);
        }
        options.reservedTurns.ensureGeneralTurns(id);
    };
};
