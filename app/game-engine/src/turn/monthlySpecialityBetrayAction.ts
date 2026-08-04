import { JosaUtil, LiteHashDRBG, RandUtil } from '@sammo-ts/common';
import {
    LogCategory,
    LogFormat,
    LogScope,
    TraitSelector,
    WAR_TRAIT_KEYS,
    loadDomesticTraitModules,
    loadWarTraitModules,
    type TraitModule,
} from '@sammo-ts/logic';
import { simpleSerialize } from '@sammo-ts/logic/war/utils.js';

import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import type { MonthlyEventActionHandler, MonthlyEventEnvironment } from './monthlyEventHandler.js';
import type { TurnGeneral } from './types.js';

const LEGACY_DOMESTIC_SELECTION_KEYS = [
    'che_경작',
    'che_상재',
    'che_발명',
    'che_축성',
    'che_수비',
    'che_통찰',
    'che_인덕',
    'che_귀모',
] as const;

const normalizeCode = (value: unknown): string | null =>
    typeof value === 'string' && value !== '' && value !== 'None' ? value : null;

const readFiniteNumber = (source: Record<string, unknown>, keys: readonly string[]): number | null => {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
    }
    return null;
};

const readStringList = (source: Record<string, unknown>, key: string): string[] => {
    const value = source[key];
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
};

const resolveHiddenSeed = (world: InMemoryTurnWorld): string | number => {
    const state = world.getState();
    const value = state.meta.hiddenSeed ?? state.meta.seed ?? state.id;
    return typeof value === 'string' || typeof value === 'number' ? value : String(value);
};

const readRuntimeNumber = (world: InMemoryTurnWorld, key: string, fallback: number): number => {
    const value = world.getScenarioConfig().const[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

const buildSpecialityAge = (retirementYear: number, age: number, relativeYear: number, divisor: number): number =>
    Math.max(Math.round((retirementYear - age) / divisor - relativeYear / 2), 3) + age;

const resolveSpecialityAge = (
    general: TurnGeneral,
    environment: MonthlyEventEnvironment,
    retirementYear: number,
    kind: 'domestic' | 'war'
): number => {
    const stored = readFiniteNumber(
        general.meta,
        kind === 'domestic' ? ['specage', 'specAge'] : ['specage2', 'specAge2']
    );
    if (stored !== null) {
        return stored;
    }

    const currentRelativeYear = Math.max(environment.year - environment.startyear, 0);
    const startAge =
        typeof general.startAge === 'number' && Number.isFinite(general.startAge)
            ? general.startAge
            : general.age - currentRelativeYear;
    const yearsSinceCreation = Math.max(general.age - startAge, 0);
    const creationRelativeYear = Math.max(currentRelativeYear - yearsSinceCreation, 0);
    return buildSpecialityAge(retirementYear, startAge, creationRelativeYear, kind === 'domestic' ? 12 : 6);
};

const pushSpecialityLogs = (
    world: InMemoryTurnWorld,
    general: TurnGeneral,
    traitName: string,
    environment: MonthlyEventEnvironment
): void => {
    const josaUl = JosaUtil.pick(traitName, '을');
    world.pushLog({
        scope: LogScope.GENERAL,
        category: LogCategory.HISTORY,
        generalId: general.id,
        text: `특기 【<b><C>${traitName}</></b>】${josaUl} 습득`,
        format: LogFormat.YEAR_MONTH,
        year: environment.year,
        month: environment.month,
    });
    world.pushLog({
        scope: LogScope.GENERAL,
        category: LogCategory.ACTION,
        generalId: general.id,
        text: `특기 【<b><L>${traitName}</></b>】${josaUl} 익혔습니다!`,
        format: LogFormat.PLAIN,
        year: environment.year,
        month: environment.month,
    });
};

const resolveTrait = (modules: readonly TraitModule[], key: string, label: string): TraitModule => {
    const module = modules.find((candidate) => candidate.key === key);
    if (!module) {
        throw new Error(`Unknown ${label} speciality: ${key}`);
    }
    return module;
};

export const createAssignGeneralSpecialityHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
}): MonthlyEventActionHandler => {
    let modulePromise: Promise<{ domesticModules: TraitModule[]; warModules: TraitModule[] }> | undefined;
    const loadModules = () => {
        modulePromise ??= Promise.all([
            loadDomesticTraitModules([...LEGACY_DOMESTIC_SELECTION_KEYS]),
            loadWarTraitModules([...WAR_TRAIT_KEYS]),
        ]).then(([domesticModules, warModules]) => ({ domesticModules, warModules }));
        return modulePromise;
    };

    return async (_args, environment) => {
        const world = options.getWorld();
        if (!world || environment.year < environment.startyear + 3) {
            return;
        }
        const { domesticModules, warModules } = await loadModules();
        const rng = new RandUtil(
            new LiteHashDRBG(
                simpleSerialize(
                    resolveHiddenSeed(world),
                    'assignGeneralSpeciality',
                    environment.year,
                    environment.month
                )
            )
        );
        const defaultDomestic = normalizeCode(world.getScenarioConfig().const.defaultSpecialDomestic);
        const defaultWar = normalizeCode(world.getScenarioConfig().const.defaultSpecialWar);
        const retirementYear = readRuntimeNumber(world, 'retirementYear', 80);
        const scenarioStat = world.getScenarioConfig().stat;
        // ref SQL에 ORDER BY가 없으므로 loader가 보존한 DB scan 순서를 두
        // domestic/war pass에서 그대로 재사용한다.
        const generals = world.listGenerals().sort((left, right) => {
            const leftOrder = readFiniteNumber(left.meta, ['legacyScanOrder']) ?? left.id;
            const rightOrder = readFiniteNumber(right.meta, ['legacyScanOrder']) ?? right.id;
            return leftOrder - rightOrder;
        });

        for (const general of generals) {
            if (
                general.role.specialDomestic !== defaultDomestic ||
                resolveSpecialityAge(general, environment, retirementYear, 'domestic') > general.age
            ) {
                continue;
            }
            const key = TraitSelector.pickDomesticTrait(
                rng,
                general.stats,
                domesticModules,
                readStringList(general.meta, 'prev_types_special'),
                scenarioStat
            );
            if (!key) {
                throw new Error(`Unable to assign domestic speciality (generalId=${general.id}).`);
            }
            const trait = resolveTrait(domesticModules, key, 'domestic');
            world.updateGeneral(general.id, {
                role: { ...general.role, specialDomestic: key },
            });
            pushSpecialityLogs(world, general, trait.name, environment);
        }

        for (const general of generals) {
            const currentGeneral = world.getGeneralById(general.id) ?? general;
            if (
                currentGeneral.role.specialWar !== defaultWar ||
                resolveSpecialityAge(currentGeneral, environment, retirementYear, 'war') > currentGeneral.age
            ) {
                continue;
            }
            const inherited = currentGeneral.meta.inheritSpecificSpecialWar;
            let key: string | null;
            let meta = currentGeneral.meta;
            let removeInherited = false;
            if (Object.prototype.hasOwnProperty.call(currentGeneral.meta, 'inheritSpecificSpecialWar')) {
                if (typeof inherited !== 'string') {
                    throw new Error(`Invalid inherited war speciality (generalId=${currentGeneral.id}).`);
                }
                key = inherited;
                removeInherited = true;
            } else {
                key = TraitSelector.pickWarTrait(
                    rng,
                    currentGeneral.stats,
                    [
                        readFiniteNumber(currentGeneral.meta, ['dex1']) ?? 0,
                        readFiniteNumber(currentGeneral.meta, ['dex2']) ?? 0,
                        readFiniteNumber(currentGeneral.meta, ['dex3']) ?? 0,
                        readFiniteNumber(currentGeneral.meta, ['dex4']) ?? 0,
                        readFiniteNumber(currentGeneral.meta, ['dex5']) ?? 0,
                    ],
                    warModules,
                    readStringList(currentGeneral.meta, 'prev_types_special2'),
                    scenarioStat
                );
            }
            if (!key) {
                throw new Error(`Unable to assign war speciality (generalId=${currentGeneral.id}).`);
            }
            const trait = resolveTrait(warModules, key, 'war');
            if (removeInherited) {
                delete currentGeneral.meta.inheritSpecificSpecialWar;
                meta = { ...currentGeneral.meta };
            }
            world.updateGeneral(currentGeneral.id, {
                role: { ...currentGeneral.role, specialWar: key },
                meta,
            });
            pushSpecialityLogs(world, currentGeneral, trait.name, environment);
        }
    };
};

const readOptionalInteger = (value: unknown, fallback: number, label: string): number => {
    if (value === undefined) {
        return fallback;
    }
    if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new Error(`${label} must be an integer.`);
    }
    return value;
};

export const createAddGlobalBetrayHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
}): MonthlyEventActionHandler => {
    return (args) => {
        const world = options.getWorld();
        if (!world) {
            return;
        }
        const count = readOptionalInteger(args[0], 1, 'AddGlobalBetray count');
        const maximum = readOptionalInteger(args[1], 0, 'AddGlobalBetray maximum');
        for (const general of world.listGenerals()) {
            const betray = readFiniteNumber(general.meta, ['betray']) ?? 0;
            if (betray > maximum) {
                continue;
            }
            world.updateGeneral(general.id, {
                meta: { ...general.meta, betray: betray + count },
            });
        }
    };
};
