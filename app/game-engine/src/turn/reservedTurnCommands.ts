import type {
    GeneralActionDefinition,
    GeneralTurnCommandKey,
    NationTurnCommandKey,
    ScenarioConfig,
    TurnCommandEnv,
    TurnCommandProfile,
    UnitSetDefinition,
} from '@sammo-ts/logic';
import {
    LEGACY_RANDOM_GENERAL_FIRST_NAMES,
    LEGACY_RANDOM_GENERAL_LAST_NAMES,
    loadGeneralTurnCommandSpecs,
    loadNationTurnCommandSpecs,
    loadActionModuleBundle,
} from '@sammo-ts/logic';
import { asRecord } from '@sammo-ts/common';

// legacy GameConstBase 기본값
const DEFAULT_GENERAL_GOLD = 1000;
const DEFAULT_GENERAL_RICE = 1000;
const DEFAULT_CREW_TYPE_ID = 1100;
const DEFAULT_TRAIN_DELTA = 30;
const DEFAULT_ATMOS_DELTA = 30;
const DEFAULT_MAX_TRAIN_BY_COMMAND = 100;
const DEFAULT_MAX_ATMOS_BY_COMMAND = 100;
const DEFAULT_SABOTAGE_PROB = 0.35;
const DEFAULT_SABOTAGE_PROB_COEF = 300;
const DEFAULT_SABOTAGE_DEFENCE_COEF = 0.04;
const DEFAULT_SABOTAGE_DAMAGE_MIN = 100;
const DEFAULT_SABOTAGE_DAMAGE_MAX = 800;
const DEFAULT_OPENING_PART_YEAR = 3;
const DEFAULT_MAX_GENERAL = 500;
const DEFAULT_INITIAL_NATION_GEN_LIMIT = 10;
const DEFAULT_MAX_TECH_LEVEL = 12;
const DEFAULT_BASE_GOLD = 0;
const DEFAULT_BASE_RICE = 2000;
const DEFAULT_GENERAL_MINIMUM_GOLD = 0;
const DEFAULT_GENERAL_MINIMUM_RICE = 500;
const DEFAULT_NPC_SEIZURE_MESSAGE_PROB = 0.01;
const DEFAULT_MAX_RESOURCE_ACTION_AMOUNT = 10000;

const normalizeCode = (value: string | null | undefined): string | null => {
    if (!value || value === 'None') {
        return null;
    }
    return value;
};

const resolveNumber = (source: Record<string, unknown>, keys: string[], fallback: number): number => {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
    }
    return fallback;
};

const resolveOptionalString = (source: Record<string, unknown>, keys: string[]): string | null => {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'string') {
            return normalizeCode(value);
        }
    }
    return null;
};

const resolveStringList = (source: Record<string, unknown>, key: string, fallback: readonly string[]): string[] => {
    const value = source[key];
    if (!Array.isArray(value)) {
        return [...fallback];
    }
    const result = value.filter((entry): entry is string => typeof entry === 'string');
    return result.length > 0 ? result : [...fallback];
};

export const buildCommandEnv = (config: ScenarioConfig, unitSet?: UnitSetDefinition): TurnCommandEnv => {
    const constValues = asRecord(config.const);

    return {
        ...(unitSet ? { unitSet } : {}),
        scenarioEffect: config.environment.scenarioEffect ?? null,
        develCost: resolveNumber(constValues, ['develCost', 'develcost', 'develrate'], 0),
        minAvailableRecruitPop: resolveNumber(constValues, ['minAvailableRecruitPop'], 30000),
        trainDelta: resolveNumber(constValues, ['trainDelta'], DEFAULT_TRAIN_DELTA),
        atmosDelta: resolveNumber(constValues, ['atmosDelta'], DEFAULT_ATMOS_DELTA),
        trainSideEffectByAtmosTurn: resolveNumber(constValues, ['trainSideEffectByAtmosTurn'], 1),
        maxTrainByCommand: resolveNumber(constValues, ['maxTrainByCommand'], DEFAULT_MAX_TRAIN_BY_COMMAND),
        maxAtmosByCommand: resolveNumber(constValues, ['maxAtmosByCommand'], DEFAULT_MAX_ATMOS_BY_COMMAND),
        sabotageDefaultProb: resolveNumber(constValues, ['sabotageDefaultProb'], DEFAULT_SABOTAGE_PROB),
        sabotageProbCoefByStat: resolveNumber(constValues, ['sabotageProbCoefByStat'], DEFAULT_SABOTAGE_PROB_COEF),
        sabotageDefenceCoefByGeneralCount: resolveNumber(
            constValues,
            ['sabotageDefenceCoefByGeneralCount'],
            DEFAULT_SABOTAGE_DEFENCE_COEF
        ),
        sabotageDamageMin: resolveNumber(constValues, ['sabotageDamageMin'], DEFAULT_SABOTAGE_DAMAGE_MIN),
        sabotageDamageMax: resolveNumber(constValues, ['sabotageDamageMax'], DEFAULT_SABOTAGE_DAMAGE_MAX),
        openingPartYear: resolveNumber(constValues, ['openingPartYear'], DEFAULT_OPENING_PART_YEAR),
        maxGeneral: resolveNumber(constValues, ['defaultMaxGeneral', 'maxGeneral'], DEFAULT_MAX_GENERAL),
        defaultNpcGold: resolveNumber(constValues, ['defaultNpcGold', 'defaultGold'], DEFAULT_GENERAL_GOLD),
        defaultNpcRice: resolveNumber(constValues, ['defaultNpcRice', 'defaultRice'], DEFAULT_GENERAL_RICE),
        defaultCrewTypeId: resolveNumber(
            constValues,
            ['defaultCrewTypeId'],
            unitSet?.defaultCrewTypeId ?? DEFAULT_CREW_TYPE_ID
        ),
        defaultSpecialDomestic: resolveOptionalString(constValues, ['defaultSpecialDomestic']),
        defaultSpecialWar: resolveOptionalString(constValues, ['defaultSpecialWar']),
        npcStatTotal: resolveNumber(constValues, ['defaultStatNPCTotal', 'npcStatTotal'], config.stat.npcTotal),
        npcStatMin: resolveNumber(constValues, ['defaultStatNPCMin', 'npcStatMin'], config.stat.npcMin),
        npcStatMax: resolveNumber(constValues, ['defaultStatNPCMax', 'npcStatMax'], config.stat.npcMax),
        randomGeneralFirstNames: resolveStringList(constValues, 'randGenFirstName', LEGACY_RANDOM_GENERAL_FIRST_NAMES),
        randomGeneralMiddleNames: resolveStringList(constValues, 'randGenMiddleName', ['']),
        randomGeneralLastNames: resolveStringList(constValues, 'randGenLastName', LEGACY_RANDOM_GENERAL_LAST_NAMES),
        availablePersonalities: resolveStringList(constValues, 'availablePersonality', [
            'che_안전',
            'che_유지',
            'che_재간',
            'che_출세',
            'che_할거',
            'che_정복',
            'che_패권',
            'che_의협',
            'che_대의',
            'che_왕좌',
        ]),
        initialNationGenLimit: resolveNumber(constValues, ['initialNationGenLimit'], DEFAULT_INITIAL_NATION_GEN_LIMIT),
        maxTechLevel: resolveNumber(constValues, ['maxTechLevel'], DEFAULT_MAX_TECH_LEVEL),
        maxStatLevel: resolveNumber(constValues, ['maxLevel'], config.stat.max),
        maxDedicationLevel: resolveNumber(constValues, ['maxDedLevel'], 30),
        statUpgradeLimit: resolveNumber(constValues, ['upgradeLimit'], 30),
        techLevelIncYear: resolveNumber(constValues, ['techLevelIncYear'], 5),
        initialAllowedTechLevel: resolveNumber(constValues, ['initialAllowedTechLevel'], 1),
        baseGold: resolveNumber(constValues, ['baseGold', 'basegold'], DEFAULT_BASE_GOLD),
        baseRice: resolveNumber(constValues, ['baseRice', 'baserice'], DEFAULT_BASE_RICE),
        generalMinimumGold: resolveNumber(constValues, ['generalMinimumGold'], DEFAULT_GENERAL_MINIMUM_GOLD),
        generalMinimumRice: resolveNumber(constValues, ['generalMinimumRice'], DEFAULT_GENERAL_MINIMUM_RICE),
        npcSeizureMessageProb: resolveNumber(constValues, ['npcSeizureMessageProb'], DEFAULT_NPC_SEIZURE_MESSAGE_PROB),
        maxResourceActionAmount: resolveNumber(
            constValues,
            ['maxResourceActionAmount'],
            DEFAULT_MAX_RESOURCE_ACTION_AMOUNT
        ),
    };
};

const ensureGeneralFallback = async (
    definitions: Map<string, GeneralActionDefinition>,
    fallbackKey: GeneralTurnCommandKey,
    env: TurnCommandEnv
): Promise<void> => {
    if (definitions.has(fallbackKey)) {
        return;
    }
    const [spec] = await loadGeneralTurnCommandSpecs([fallbackKey]);
    if (!spec) {
        return;
    }
    definitions.set(fallbackKey, spec.createDefinition(env));
};

export const buildReservedTurnDefinitions = async (options: {
    env: TurnCommandEnv;
    commandProfile: TurnCommandProfile;
    defaultActionKey: GeneralTurnCommandKey & NationTurnCommandKey;
}): Promise<{
    general: Map<string, GeneralActionDefinition>;
    nation: Map<string, GeneralActionDefinition>;
}> => {
    const moduleBundle = await loadActionModuleBundle(options.env.unitSet, options.env.scenarioEffect);
    const itemModules = moduleBundle.itemModules;
    options.env.itemCatalog = Object.fromEntries(
        itemModules.map((item) => [
            item.key,
            {
                slot: item.slot,
                name: item.name,
                rawName: item.rawName,
                cost: item.cost,
                reqSecu: item.reqSecu,
                buyable: item.buyable,
                unique: item.unique,
                ...(item.initialCharges === undefined ? {} : { initialCharges: item.initialCharges }),
            },
        ])
    );
    options.env.generalActionModules ??= moduleBundle.general;
    options.env.warActionModules ??= moduleBundle.war;
    options.env.nationTraitModules = moduleBundle.nationTraitModules;

    const generalSpecs = await loadGeneralTurnCommandSpecs(options.commandProfile.general);
    const nationSpecs = await loadNationTurnCommandSpecs(options.commandProfile.nation);

    const general = new Map(generalSpecs.map((spec) => [spec.key, spec.createDefinition(options.env)]));
    const nation = new Map(nationSpecs.map((spec) => [spec.key, spec.createDefinition(options.env)]));

    await ensureGeneralFallback(general, options.defaultActionKey, options.env);
    if (!nation.has(options.defaultActionKey)) {
        const [spec] = await loadNationTurnCommandSpecs([options.defaultActionKey]);
        if (spec) {
            nation.set(spec.key, spec.createDefinition(options.env));
        }
    }

    return { general, nation };
};
