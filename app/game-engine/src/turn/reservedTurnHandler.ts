import type {
    City,
    General,
    GeneralActionDefinition,
    GeneralActionResolveContext,
    LogEntryDraft,
    MapDefinition,
    Nation,
    ScenarioConfig,
    ScenarioDiplomacy,
    ScenarioMeta,
    Troop,
    UnitSetDefinition,
} from '@sammo-ts/logic';
import {
    AssignmentActionDefinition,
    AwardActionDefinition,
    CommerceInvestmentActionDefinition,
    evaluateConstraints,
    FireAttackActionDefinition,
    NationRestActionDefinition,
    RecruitActionDefinition,
    resolveGeneralAction,
    RestActionDefinition,
    TalentScoutActionDefinition,
    VolunteerRecruitActionDefinition,
} from '@sammo-ts/logic';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic';
import { LiteHashDRBG } from '@sammo-ts/common';

import type { ConstraintContext, StateView } from '@sammo-ts/logic';

import type { GeneralTurnHandler, GeneralTurnResult } from './inMemoryWorld.js';
import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import type { TurnGeneral, TurnWorldState } from './types.js';
import type { ReservedTurnEntry } from './reservedTurnStore.js';
import type { InMemoryReservedTurnStore } from './reservedTurnStore.js';

interface CommandEnv {
    develCost: number;
    sabotageDefaultProb: number;
    sabotageProbCoefByStat: number;
    sabotageDefenceCoefByGeneralCount: number;
    sabotageDamageMin: number;
    sabotageDamageMax: number;
    openingPartYear: number;
    maxGeneral: number;
    defaultNpcGold: number;
    defaultNpcRice: number;
    defaultCrewTypeId: number;
    defaultSpecialDomestic: string | null;
    defaultSpecialWar: string | null;
    initialNationGenLimit: number;
    baseGold: number;
    baseRice: number;
    maxResourceActionAmount: number;
}

interface WorldSummary {
    totalGeneralCount: number;
    totalNpcCount: number;
    averageStats?: General['stats'];
}

interface NationSummary {
    averageStats?: General['stats'];
    averageExperience?: number;
    averageDedication?: number;
}

const DEFAULT_GENERAL_GOLD = 1000;
const DEFAULT_GENERAL_RICE = 1000;
const DEFAULT_CREW_TYPE_ID = 1100;
const DEFAULT_ACTION = '휴식';

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

const asRecord = (value: unknown): Record<string, unknown> =>
    isRecord(value) ? value : {};

const normalizeCode = (value: string | null | undefined): string | null => {
    if (!value || value === 'None') {
        return null;
    }
    return value;
};

const resolveNumber = (
    source: Record<string, unknown>,
    keys: string[],
    fallback: number
): number => {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
    }
    return fallback;
};

const resolveOptionalString = (
    source: Record<string, unknown>,
    keys: string[]
): string | null => {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'string') {
            return normalizeCode(value);
        }
    }
    return null;
};

const buildCommandEnv = (
    config: ScenarioConfig,
    unitSet?: UnitSetDefinition
): CommandEnv => {
    const constValues = asRecord(config.const);

    return {
        develCost: resolveNumber(
            constValues,
            ['develCost', 'develcost', 'develrate'],
            0
        ),
        sabotageDefaultProb: resolveNumber(
            constValues,
            ['sabotageDefaultProb'],
            0
        ),
        sabotageProbCoefByStat: resolveNumber(
            constValues,
            ['sabotageProbCoefByStat'],
            0
        ),
        sabotageDefenceCoefByGeneralCount: resolveNumber(
            constValues,
            ['sabotageDefenceCoefByGeneralCount'],
            0
        ),
        sabotageDamageMin: resolveNumber(
            constValues,
            ['sabotageDamageMin'],
            0
        ),
        sabotageDamageMax: resolveNumber(
            constValues,
            ['sabotageDamageMax'],
            0
        ),
        openingPartYear: resolveNumber(
            constValues,
            ['openingPartYear'],
            0
        ),
        maxGeneral: resolveNumber(
            constValues,
            ['defaultMaxGeneral', 'maxGeneral'],
            0
        ),
        defaultNpcGold: resolveNumber(
            constValues,
            ['defaultNpcGold', 'defaultGold'],
            DEFAULT_GENERAL_GOLD
        ),
        defaultNpcRice: resolveNumber(
            constValues,
            ['defaultNpcRice', 'defaultRice'],
            DEFAULT_GENERAL_RICE
        ),
        defaultCrewTypeId: resolveNumber(
            constValues,
            ['defaultCrewTypeId'],
            unitSet?.defaultCrewTypeId ?? DEFAULT_CREW_TYPE_ID
        ),
        defaultSpecialDomestic: resolveOptionalString(
            constValues,
            ['defaultSpecialDomestic']
        ),
        defaultSpecialWar: resolveOptionalString(
            constValues,
            ['defaultSpecialWar']
        ),
        initialNationGenLimit: resolveNumber(
            constValues,
            ['initialNationGenLimit'],
            0
        ),
        baseGold: resolveNumber(constValues, ['baseGold', 'basegold'], 0),
        baseRice: resolveNumber(constValues, ['baseRice', 'baserice'], 0),
        maxResourceActionAmount: resolveNumber(
            constValues,
            ['maxResourceActionAmount'],
            0
        ),
    };
};

const resolveConstraintEnv = (
    world: TurnWorldState,
    scenarioMeta?: ScenarioMeta
): Record<string, unknown> => {
    const startYear =
        typeof scenarioMeta?.startYear === 'number'
            ? scenarioMeta.startYear
            : undefined;
    const relYear =
        typeof startYear === 'number'
            ? world.currentYear - startYear
            : undefined;

    return {
        currentYear: world.currentYear,
        currentMonth: world.currentMonth,
        year: world.currentYear,
        month: world.currentMonth,
        startYear,
        relYear,
    };
};

const buildDiplomacyMap = (
    diplomacy: ScenarioDiplomacy[]
): Map<string, number> => {
    const map = new Map<string, number>();
    for (const row of diplomacy) {
        map.set(`${row.fromNationId}:${row.toNationId}`, row.state);
    }
    return map;
};

const buildWorldSummary = (
    world: InMemoryTurnWorld | null
): WorldSummary => {
    if (!world) {
        return { totalGeneralCount: 0, totalNpcCount: 0 };
    }
    const generals = world.listGenerals();
    if (generals.length === 0) {
        return { totalGeneralCount: 0, totalNpcCount: 0 };
    }
    const total = generals.length;
    const npcCount = generals.filter((general) => general.npcState > 0).length;
    const statSum = generals.reduce(
        (acc, general) => ({
            leadership: acc.leadership + general.stats.leadership,
            strength: acc.strength + general.stats.strength,
            intelligence: acc.intelligence + general.stats.intelligence,
        }),
        { leadership: 0, strength: 0, intelligence: 0 }
    );
    return {
        totalGeneralCount: total,
        totalNpcCount: npcCount,
        averageStats: {
            leadership: statSum.leadership / total,
            strength: statSum.strength / total,
            intelligence: statSum.intelligence / total,
        },
    };
};

const buildNationSummary = (
    world: InMemoryTurnWorld | null,
    nationId: number
): NationSummary => {
    if (!world || nationId <= 0) {
        return {};
    }
    const generals = world.listGenerals().filter(
        (general) => general.nationId === nationId
    );
    if (generals.length === 0) {
        return {};
    }
    const total = generals.length;
    const statSum = generals.reduce(
        (acc, general) => ({
            leadership: acc.leadership + general.stats.leadership,
            strength: acc.strength + general.stats.strength,
            intelligence: acc.intelligence + general.stats.intelligence,
        }),
        { leadership: 0, strength: 0, intelligence: 0 }
    );
    const expSum = generals.reduce((acc, general) => acc + general.experience, 0);
    const dedSum = generals.reduce((acc, general) => acc + general.dedication, 0);
    return {
        averageStats: {
            leadership: statSum.leadership / total,
            strength: statSum.strength / total,
            intelligence: statSum.intelligence / total,
        },
        averageExperience: expSum / total,
        averageDedication: dedSum / total,
    };
};

const buildAverageNationGeneralCount = (world: InMemoryTurnWorld | null): number => {
    if (!world) {
        return 0;
    }
    const generals = world.listGenerals();
    const nations = world.listNations();
    if (nations.length === 0) {
        return generals.length;
    }
    return generals.length / nations.length;
};

const resolveStartYear = (
    world: TurnWorldState,
    scenarioMeta?: ScenarioMeta
): number => {
    if (typeof scenarioMeta?.startYear === 'number') {
        return scenarioMeta.startYear;
    }
    return world.currentYear;
};

const buildSeedBase = (world: TurnWorldState): string => {
    const meta = asRecord(world.meta);
    const rawSeed = meta.hiddenSeed ?? meta.seed ?? world.id;
    return String(rawSeed);
};

const serializeSeed = (...values: Array<string | number>): string =>
    values
        .map((value) =>
            typeof value === 'string'
                ? `str(${value.length},${value})`
                : `int(${Math.floor(value)})`
        )
        .join('|');

class DeterministicRandom {
    constructor(private readonly rng: LiteHashDRBG) {}

    nextFloat(): number {
        return this.rng.nextFloat1();
    }

    nextBool(probability: number): boolean {
        if (probability >= 1) {
            return true;
        }
        if (probability <= 0) {
            return false;
        }
        return this.nextFloat() < probability;
    }

    nextInt(minInclusive: number, maxExclusive: number): number {
        const span = maxExclusive - minInclusive;
        if (span <= 1) {
            return minInclusive;
        }
        return minInclusive + this.rng.nextInt(span - 1);
    }
}

class WorldStateView implements StateView {
    constructor(
        private readonly world: InMemoryTurnWorld | null,
        private readonly diplomacy: Map<string, number>,
        private readonly env: Record<string, unknown>,
        private readonly args: Record<string, unknown>,
        private readonly overrides?: {
            general?: TurnGeneral;
            city?: City;
            nation?: Nation | null;
        }
    ) {}

    has(req: Parameters<StateView['has']>[0]): boolean {
        return this.get(req) !== null;
    }

    get(req: Parameters<StateView['get']>[0]): unknown | null {
        if (!this.world) {
            return null;
        }
        switch (req.kind) {
            case 'general':
                if (this.overrides?.general && this.overrides.general.id === req.id) {
                    return this.overrides.general;
                }
                return this.world.getGeneralById(req.id);
            case 'destGeneral':
                return this.world.getGeneralById(req.id);
            case 'city':
                if (this.overrides?.city && this.overrides.city.id === req.id) {
                    return this.overrides.city;
                }
                return this.world.getCityById(req.id);
            case 'destCity':
                return this.world.getCityById(req.id);
            case 'nation':
                if (this.overrides?.nation && this.overrides.nation.id === req.id) {
                    return this.overrides.nation;
                }
                return this.world.getNationById(req.id);
            case 'destNation':
                return this.world.getNationById(req.id);
            case 'diplomacy':
                return this.diplomacy.get(
                    `${req.srcNationId}:${req.destNationId}`
                ) ?? null;
            case 'arg':
                return this.args[req.key] ?? null;
            case 'env':
                return this.env[req.key] ?? null;
            default:
                return null;
        }
    }
}

const buildGeneralDefinitions = (
    env: CommandEnv
): Map<string, GeneralActionDefinition> => {
    const definitions = new Map<string, GeneralActionDefinition>();
    definitions.set(
        'che_상업투자',
        new CommerceInvestmentActionDefinition([], env)
    );
    definitions.set('che_화계', new FireAttackActionDefinition([], env));
    definitions.set('che_인재탐색', new TalentScoutActionDefinition([], env));
    definitions.set('che_의병모집', new VolunteerRecruitActionDefinition([], env));
    definitions.set('che_징병', new RecruitActionDefinition([], {}));
    definitions.set('휴식', new RestActionDefinition());
    return definitions;
};

const buildNationDefinitions = (
    env: CommandEnv
): Map<string, GeneralActionDefinition> => {
    const definitions = new Map<string, GeneralActionDefinition>();
    const maxAmount =
        env.maxResourceActionAmount > 0
            ? env.maxResourceActionAmount
            : Math.max(env.baseGold, env.baseRice, 1000);
    definitions.set('휴식', new NationRestActionDefinition());
    definitions.set(
        'che_포상',
        new AwardActionDefinition({
            baseGold: env.baseGold,
            baseRice: env.baseRice,
            maxAmount,
        })
    );
    definitions.set('che_발령', new AssignmentActionDefinition({}));
    return definitions;
};

const extractArgsRecord = (value: unknown): Record<string, unknown> =>
    isRecord(value) ? value : {};

const resolveTurnTermMinutes = (world: TurnWorldState): number =>
    Math.max(1, Math.round(world.tickSeconds / 60));

type ActionContextBase = {
    general: TurnGeneral;
    city?: City;
    nation?: Nation | null;
    rng: DeterministicRandom;
};

type ActionResolveContext = ActionContextBase & Record<string, unknown>;

const buildActionContext = (
    key: string,
    base: ActionContextBase,
    options: {
        world: TurnWorldState;
        scenarioMeta?: ScenarioMeta;
        map?: MapDefinition;
        unitSet?: UnitSetDefinition;
        worldRef: InMemoryTurnWorld | null;
        actionArgs: Record<string, unknown>;
        createGeneralId: () => number;
    }
): ActionResolveContext | null => {
    switch (key) {
        case 'che_인재탐색':
            return {
                ...base,
                currentYear: options.world.currentYear,
                worldSummary: buildWorldSummary(options.worldRef),
                createGeneralId: options.createGeneralId,
            };
        case 'che_의병모집': {
            const nationSummary = buildNationSummary(
                options.worldRef,
                (base.general as TurnGeneral).nationId
            );
            return {
                ...base,
                currentYear: options.world.currentYear,
                startYear: resolveStartYear(options.world, options.scenarioMeta),
                averageNationGeneralCount: buildAverageNationGeneralCount(
                    options.worldRef
                ),
                nationAverageStats: nationSummary.averageStats,
                nationAverageExperience: nationSummary.averageExperience,
                nationAverageDedication: nationSummary.averageDedication,
                createGeneralId: options.createGeneralId,
            };
        }
        case 'che_포상': {
            const destGeneralId = options.actionArgs.destGeneralId;
            if (typeof destGeneralId !== 'number') {
                return null;
            }
            const destGeneral = options.worldRef?.getGeneralById(destGeneralId);
            if (!destGeneral) {
                return null;
            }
            return {
                ...base,
                destGeneral,
            };
        }
        case 'che_발령': {
            const destGeneralId = options.actionArgs.destGeneralId;
            const destCityId = options.actionArgs.destCityId;
            if (typeof destGeneralId !== 'number' || typeof destCityId !== 'number') {
                return null;
            }
            const destGeneral = options.worldRef?.getGeneralById(destGeneralId);
            const destCity = options.worldRef?.getCityById(destCityId);
            if (!destGeneral || !destCity) {
                return null;
            }
            return {
                ...base,
                destGeneral,
                destCity,
                currentYear: options.world.currentYear,
                currentMonth: options.world.currentMonth,
                turnTermMinutes: resolveTurnTermMinutes(options.world),
                generalTurnTime: (base.general as TurnGeneral).turnTime,
                destGeneralTurnTime: destGeneral.turnTime,
            };
        }
        case 'che_징병':
            if (!options.map || !options.unitSet) {
                return null;
            }
            return {
                ...base,
                map: options.map,
                unitSet: options.unitSet,
                cities: options.worldRef?.listCities() ?? [],
                currentYear: options.world.currentYear,
                startYear: resolveStartYear(options.world, options.scenarioMeta),
            };
        default:
            return base;
    }
};

const buildConstraintContext = (
    general: TurnGeneral,
    city: City | undefined,
    nation: Nation | null | undefined,
    args: Record<string, unknown>,
    env: Record<string, unknown>
): ConstraintContext => ({
    actorId: general.id,
    cityId: city?.id,
    nationId: nation?.id,
    args,
    env,
    mode: 'full',
});

const createActionLog = (message: string): LogEntryDraft => ({
    scope: LogScope.GENERAL,
    category: LogCategory.ACTION,
    format: LogFormat.MONTH,
    text: message,
});

const resolveDefinition = (
    actionKey: string,
    definitions: Map<string, GeneralActionDefinition>,
    fallback: GeneralActionDefinition
): GeneralActionDefinition => definitions.get(actionKey) ?? fallback;

export const createReservedTurnHandler = (options: {
    reservedTurns: InMemoryReservedTurnStore;
    scenarioConfig: ScenarioConfig;
    scenarioMeta?: ScenarioMeta;
    diplomacy: ScenarioDiplomacy[];
    map?: MapDefinition;
    unitSet?: UnitSetDefinition;
    getWorld: () => InMemoryTurnWorld | null;
}): GeneralTurnHandler => {
    const env = buildCommandEnv(options.scenarioConfig, options.unitSet);
    const generalDefinitions = buildGeneralDefinitions(env);
    const nationDefinitions = buildNationDefinitions(env);
    const generalFallback = generalDefinitions.get(DEFAULT_ACTION)!;
    const nationFallback = nationDefinitions.get(DEFAULT_ACTION)!;
    const diplomacyMap = buildDiplomacyMap(options.diplomacy);

    let nextGeneralId: number | null = null;
    const createGeneralId = (): number => {
        if (nextGeneralId === null) {
            const world = options.getWorld();
            const ids = world ? world.listGenerals().map((general) => general.id) : [];
            nextGeneralId = ids.length > 0 ? Math.max(...ids) + 1 : 1;
        }
        const result = nextGeneralId;
        nextGeneralId += 1;
        return result;
    };

    return {
        execute(context): GeneralTurnResult {
            const worldRef = options.getWorld();
            const constraintEnv = {
                ...resolveConstraintEnv(context.world, options.scenarioMeta),
                ...(options.map ? { map: options.map } : {}),
                ...(options.unitSet ? { unitSet: options.unitSet } : {}),
                cities: worldRef?.listCities() ?? [],
            };
            const logs: LogEntryDraft[] = [];
            const patches = {
                generals: [] as Array<{ id: number; patch: Partial<TurnGeneral> }>,
                cities: [] as Array<{ id: number; patch: Partial<City> }>,
                nations: [] as Array<{ id: number; patch: Partial<Nation> }>,
                troops: [] as Array<{ id: number; patch: Partial<Troop> }>,
            };
            const created: TurnGeneral[] = [];

            let currentGeneral = context.general;
            let currentCity = context.city;
            let currentNation = context.nation ?? null;

            const runAction = (
                definitionMap: Map<string, GeneralActionDefinition>,
                fallbackDefinition: GeneralActionDefinition,
                command: ReservedTurnEntry,
                applyNextTurnAt: boolean
            ): Date | undefined => {
                const resolvedDefinition = resolveDefinition(
                    command.action,
                    definitionMap,
                    fallbackDefinition
                );
                const rawArgs = extractArgsRecord(command.args);
                let parsedArgs = resolvedDefinition.parseArgs(rawArgs);
                let definition = resolvedDefinition;
                let actionArgs = parsedArgs ?? {};
                let actionKey = definition.key;

                if (parsedArgs === null) {
                    definition = fallbackDefinition;
                    actionArgs = definition.parseArgs({}) ?? {};
                    actionKey = definition.key;
                    logs.push(createActionLog('예약된 명령을 실행하지 못했습니다.'));
                }

                const constraintCtx = buildConstraintContext(
                    currentGeneral,
                    currentCity,
                    currentNation,
                    actionArgs as Record<string, unknown>,
                    constraintEnv
                );
                const view = new WorldStateView(
                    worldRef,
                    diplomacyMap,
                    constraintEnv,
                    actionArgs as Record<string, unknown>,
                    {
                        general: currentGeneral,
                        city: currentCity,
                        nation: currentNation,
                    }
                );
                const constraints = definition.buildConstraints(
                    constraintCtx,
                    actionArgs
                );
                const result = evaluateConstraints(constraints, constraintCtx, view);
                if (result.kind !== 'allow') {
                    definition = fallbackDefinition;
                    actionArgs = definition.parseArgs({}) ?? {};
                    actionKey = definition.key;
                    const reason =
                        result.kind === 'deny'
                            ? result.reason
                            : '조건을 확인할 수 없습니다.';
                    logs.push(createActionLog(reason));
                }

                const seedBase = buildSeedBase(context.world);
                const buildRng = (key: string) => {
                    const rngSeed = serializeSeed(
                        seedBase,
                        key,
                        context.world.currentYear,
                        context.world.currentMonth,
                        currentGeneral.id
                    );
                    return new DeterministicRandom(new LiteHashDRBG(rngSeed));
                };

                const actionArgsRecord = extractArgsRecord(actionArgs);
                let baseContext: ActionContextBase = {
                    general: currentGeneral,
                    city: currentCity,
                    nation: currentNation,
                    rng: buildRng(actionKey),
                };
                let specificContext = buildActionContext(actionKey, baseContext, {
                    world: context.world,
                    scenarioMeta: options.scenarioMeta,
                    map: options.map,
                    unitSet: options.unitSet,
                    worldRef,
                    actionArgs: actionArgsRecord,
                    createGeneralId,
                });
                if (!specificContext && actionKey !== fallbackDefinition.key) {
                    definition = fallbackDefinition;
                    actionArgs = definition.parseArgs({}) ?? {};
                    actionKey = definition.key;
                    logs.push(createActionLog('예약된 명령을 실행하지 못했습니다.'));
                    baseContext = {
                        general: currentGeneral,
                        city: currentCity,
                        nation: currentNation,
                        rng: buildRng(actionKey),
                    };
                    specificContext = baseContext;
                }
                const actionContext = specificContext ?? baseContext;

                const resolution = resolveGeneralAction(
                    definition,
                    actionContext as GeneralActionResolveContext,
                    {
                        now: currentGeneral.turnTime,
                        schedule: context.schedule,
                    },
                    actionArgs
                );

                currentGeneral = resolution.general as TurnGeneral;
                currentCity = resolution.city ?? currentCity;
                currentNation = resolution.nation ?? currentNation;
                logs.push(...resolution.logs);

                if (resolution.patches) {
                    patches.generals.push(
                        ...(resolution.patches.generals as Array<{
                            id: number;
                            patch: Partial<TurnGeneral>;
                        }>)
                    );
                    patches.cities.push(
                        ...(resolution.patches.cities as Array<{
                            id: number;
                            patch: Partial<City>;
                        }>)
                    );
                    patches.nations.push(
                        ...(resolution.patches.nations as Array<{
                            id: number;
                            patch: Partial<Nation>;
                        }>)
                    );
                }

                if (resolution.created?.generals) {
                    created.push(...(resolution.created.generals as TurnGeneral[]));
                }

                return applyNextTurnAt ? resolution.nextTurnAt : undefined;
            };

            if (currentNation && currentGeneral.officerLevel >= 5) {
                const nationCommand = options.reservedTurns.getNationTurn(
                    currentNation.id,
                    currentGeneral.officerLevel,
                    0
                );
                runAction(nationDefinitions, nationFallback, nationCommand, false);
                options.reservedTurns.shiftNationTurns(
                    currentNation.id,
                    currentGeneral.officerLevel,
                    -1
                );
            }

            const generalCommand = options.reservedTurns.getGeneralTurn(
                currentGeneral.id,
                0
            );
            const nextTurnAt = runAction(
                generalDefinitions,
                generalFallback,
                generalCommand,
                true
            );
            options.reservedTurns.shiftGeneralTurns(currentGeneral.id, -1);

            const result: GeneralTurnResult = {
                general: currentGeneral,
                city: currentCity,
                nation: currentNation,
                nextTurnAt,
                logs,
                patches,
                created: created.length > 0 ? { generals: created } : undefined,
            };

            return result;
        },
    };
};
