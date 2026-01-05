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
} from '@sammo-ts/logic';

const DEFAULT_GENERAL_GOLD = 1000;
const DEFAULT_GENERAL_RICE = 1000;
const DEFAULT_CREW_TYPE_ID = 1100;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

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
        develCost: resolveNumber(constValues, ['develCost', 'develcost', 'develrate'], 0),
        trainDelta: resolveNumber(constValues, ['trainDelta'], 0),
        atmosDelta: resolveNumber(constValues, ['atmosDelta'], 0),
        maxTrainByCommand: resolveNumber(constValues, ['maxTrainByCommand'], 0),
        maxAtmosByCommand: resolveNumber(constValues, ['maxAtmosByCommand'], 0),
        sabotageDefaultProb: resolveNumber(constValues, ['sabotageDefaultProb'], 0),
        sabotageProbCoefByStat: resolveNumber(constValues, ['sabotageProbCoefByStat'], 0),
        sabotageDefenceCoefByGeneralCount: resolveNumber(constValues, ['sabotageDefenceCoefByGeneralCount'], 0),
        sabotageDamageMin: resolveNumber(constValues, ['sabotageDamageMin'], 0),
        sabotageDamageMax: resolveNumber(constValues, ['sabotageDamageMax'], 0),
        openingPartYear: resolveNumber(constValues, ['openingPartYear'], 0),
        maxGeneral: resolveNumber(constValues, ['defaultMaxGeneral', 'maxGeneral'], 0),
        defaultNpcGold: resolveNumber(constValues, ['defaultNpcGold', 'defaultGold'], DEFAULT_GENERAL_GOLD),
        defaultNpcRice: resolveNumber(constValues, ['defaultNpcRice', 'defaultRice'], DEFAULT_GENERAL_RICE),
        defaultCrewTypeId: resolveNumber(
            constValues,
            ['defaultCrewTypeId'],
            unitSet?.defaultCrewTypeId ?? DEFAULT_CREW_TYPE_ID
        ),
        defaultSpecialDomestic: resolveOptionalString(constValues, ['defaultSpecialDomestic']),
        defaultSpecialWar: resolveOptionalString(constValues, ['defaultSpecialWar']),
        initialNationGenLimit: resolveNumber(constValues, ['initialNationGenLimit'], 0),
        maxTechLevel: resolveNumber(constValues, ['maxTechLevel'], 0),
        baseGold: resolveNumber(constValues, ['baseGold', 'basegold'], 0),
        baseRice: resolveNumber(constValues, ['baseRice', 'baserice'], 0),
        maxResourceActionAmount: resolveNumber(constValues, ['maxResourceActionAmount'], 0),
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
    const itemRegistry = createItemModuleRegistry(itemModules);
    const itemActionModules = createItemActionModules(itemRegistry);
    options.env.generalActionModules = [...(options.env.generalActionModules ?? []), ...itemActionModules.general];
    options.env.warActionModules = [...(options.env.warActionModules ?? []), ...itemActionModules.war];

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
