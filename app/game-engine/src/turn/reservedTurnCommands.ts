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
    loadGeneralTurnCommandSpecs,
    loadNationTurnCommandSpecs,
    createItemActionModules,
    createItemModuleRegistry,
    ITEM_KEYS,
    loadItemModules,
    createInheritBuffModules,
    compileCrewTypeCatalog,
    createCrewTypeWarTriggerRegistry,
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

export const buildCommandEnv = (config: ScenarioConfig, unitSet?: UnitSetDefinition): TurnCommandEnv => {
    const constValues = asRecord(config.const);

    return {
        ...(unitSet ? { unitSet } : {}),
        develCost: resolveNumber(constValues, ['develCost', 'develcost', 'develrate'], 0),
        minAvailableRecruitPop: resolveNumber(constValues, ['minAvailableRecruitPop'], 30000),
        trainDelta: resolveNumber(constValues, ['trainDelta'], DEFAULT_TRAIN_DELTA),
        atmosDelta: resolveNumber(constValues, ['atmosDelta'], DEFAULT_ATMOS_DELTA),
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
        initialNationGenLimit: resolveNumber(constValues, ['initialNationGenLimit'], DEFAULT_INITIAL_NATION_GEN_LIMIT),
        maxTechLevel: resolveNumber(constValues, ['maxTechLevel'], DEFAULT_MAX_TECH_LEVEL),
        baseGold: resolveNumber(constValues, ['baseGold', 'basegold'], DEFAULT_BASE_GOLD),
        baseRice: resolveNumber(constValues, ['baseRice', 'baserice'], DEFAULT_BASE_RICE),
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
    const itemModules = await loadItemModules([...ITEM_KEYS]);
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
    const itemRegistry = createItemModuleRegistry(itemModules);
    const itemActionModules = createItemActionModules(itemRegistry);
    const inheritBuffModules = createInheritBuffModules();
    const crewTypeCatalog = options.env.unitSet?.crewTypes?.length
        ? compileCrewTypeCatalog(options.env.unitSet, createCrewTypeWarTriggerRegistry())
        : null;
    options.env.generalActionModules = [
        ...(options.env.generalActionModules ?? []),
        ...(crewTypeCatalog ? [crewTypeCatalog.generalActionModule] : []),
        inheritBuffModules.general,
        ...itemActionModules.general,
    ];
    options.env.warActionModules = [
        ...(options.env.warActionModules ?? []),
        ...(crewTypeCatalog ? [crewTypeCatalog.warActionModule] : []),
        inheritBuffModules.war,
        ...itemActionModules.war,
    ];

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
