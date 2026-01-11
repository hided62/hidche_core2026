import type {
    ActionContextBase,
    ActionContextBuilder,
    City,
    GeneralActionDefinition,
    LogEntryDraft,
    MapDefinition,
    Nation,
    ScenarioConfig,
    ScenarioMeta,
    Troop,
    TurnCommandProfile,
    UnitSetDefinition,
} from '@sammo-ts/logic';
import {
    DEFAULT_TURN_COMMAND_PROFILE,
    GeneralTurnCommandLoader,
    NationTurnCommandLoader,
    defaultActionContextBuilder,
    evaluateConstraints,
    resolveGeneralAction,
} from '@sammo-ts/logic';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic';
import { LiteHashDRBG } from '@sammo-ts/common';

import type { ConstraintContext, StateView } from '@sammo-ts/logic';

import type { GeneralTurnHandler, GeneralTurnResult } from './inMemoryWorld.js';
import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import type { TurnDiplomacy, TurnGeneral, TurnWorldState } from './types.js';
import type { ReservedTurnEntry } from './reservedTurnStore.js';
import type { InMemoryReservedTurnStore } from './reservedTurnStore.js';
import {
    applyDiplomacyPatch as applyDiplomacyPatchToEntry,
    buildDefaultDiplomacy,
    buildDiplomacyKey,
    type DiplomacyPatch,
} from '@sammo-ts/logic';
import { buildCommandEnv, buildReservedTurnDefinitions } from './reservedTurnCommands.js';
import { buildActionContext } from './reservedTurnActionContext.js';
import { GeneralAI, shouldUseAi } from './ai/generalAi.js';
import type { AiReservedTurnProvider } from './ai/types.js';

const DEFAULT_ACTION = '휴식';

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

const resolveConstraintEnv = (
    world: TurnWorldState,
    scenarioMeta: ScenarioMeta | undefined,
    openingPartYear: number
): Record<string, unknown> => {
    const startYear = typeof scenarioMeta?.startYear === 'number' ? scenarioMeta.startYear : undefined;
    const relYear = typeof startYear === 'number' ? world.currentYear - startYear : undefined;

    return {
        currentYear: world.currentYear,
        currentMonth: world.currentMonth,
        year: world.currentYear,
        month: world.currentMonth,
        startYear,
        relYear,
        openingPartYear,
    };
};

const buildSeedBase = (world: TurnWorldState): string => {
    const meta = asRecord(world.meta);
    const rawSeed = meta.hiddenSeed ?? meta.seed ?? world.id;
    return String(rawSeed);
};

const serializeSeed = (...values: Array<string | number>): string =>
    values
        .map((value) => (typeof value === 'string' ? `str(${value.length},${value})` : `int(${Math.floor(value)})`))
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

type WorldView = {
    getGeneralById(id: number): TurnGeneral | null;
    getCityById(id: number): City | null;
    getNationById(id: number): Nation | null;
    getTroopById(id: number): Troop | null;
    getDiplomacyEntry(srcNationId: number, destNationId: number): TurnDiplomacy | null;
    listGenerals(): TurnGeneral[];
    listCities(): City[];
    listNations(): Nation[];
    listTroops(): Troop[];
    listDiplomacy(): TurnDiplomacy[];
};

const mergeStats = (base: TurnGeneral['stats'], patch: Partial<TurnGeneral['stats']>): TurnGeneral['stats'] => ({
    leadership: patch.leadership ?? base.leadership,
    strength: patch.strength ?? base.strength,
    intelligence: patch.intelligence ?? base.intelligence,
});

const mergeRole = (base: TurnGeneral['role'], patch: Partial<TurnGeneral['role']>): TurnGeneral['role'] => ({
    ...base,
    ...patch,
    items: {
        ...base.items,
        ...(patch.items ?? {}),
    },
});

const mergeTriggerState = (
    base: TurnGeneral['triggerState'],
    patch: Partial<TurnGeneral['triggerState']>
): TurnGeneral['triggerState'] => ({
    ...base,
    ...patch,
    flags: { ...base.flags, ...(patch.flags ?? {}) },
    counters: { ...base.counters, ...(patch.counters ?? {}) },
    modifiers: { ...base.modifiers, ...(patch.modifiers ?? {}) },
    meta: { ...base.meta, ...(patch.meta ?? {}) },
});

const applyGeneralPatch = (base: TurnGeneral, patch: Partial<TurnGeneral>): TurnGeneral => ({
    ...base,
    ...patch,
    stats: patch.stats ? mergeStats(base.stats, patch.stats) : base.stats,
    role: patch.role ? mergeRole(base.role, patch.role) : base.role,
    triggerState: patch.triggerState ? mergeTriggerState(base.triggerState, patch.triggerState) : base.triggerState,
    meta: patch.meta ? { ...base.meta, ...patch.meta } : base.meta,
});

const applyCityPatch = (base: City, patch: Partial<City>): City => ({
    ...base,
    ...patch,
    meta: patch.meta ? { ...base.meta, ...patch.meta } : base.meta,
});

const applyNationPatch = (base: Nation, patch: Partial<Nation>): Nation => ({
    ...base,
    ...patch,
    meta: patch.meta ? { ...base.meta, ...patch.meta } : base.meta,
});

const mergeDiplomacyList = (base: TurnDiplomacy[], overrides: Map<string, TurnDiplomacy>): TurnDiplomacy[] => {
    const merged = new Map<string, TurnDiplomacy>();
    for (const entry of base) {
        merged.set(buildDiplomacyKey(entry.fromNationId, entry.toNationId), entry);
    }
    for (const [key, entry] of overrides) {
        merged.set(key, entry);
    }
    return Array.from(merged.values());
};

// 예약 턴 내에서 패치를 즉시 반영하기 위한 로컬 오버레이.
const createWorldOverlay = (world: InMemoryTurnWorld) => {
    const generalOverrides = new Map<number, TurnGeneral>();
    const cityOverrides = new Map<number, City>();
    const nationOverrides = new Map<number, Nation>();
    const diplomacyOverrides = new Map<string, TurnDiplomacy>();

    const mergeList = <T extends { id: number }>(base: T[], overrides: Map<number, T>): T[] => {
        const merged = new Map<number, T>();
        for (const entry of base) {
            merged.set(entry.id, entry);
        }
        for (const [id, entry] of overrides) {
            merged.set(id, entry);
        }
        return Array.from(merged.values());
    };

    const view: WorldView = {
        getGeneralById: (id) => generalOverrides.get(id) ?? world.getGeneralById(id),
        getCityById: (id) => cityOverrides.get(id) ?? world.getCityById(id),
        getNationById: (id) => nationOverrides.get(id) ?? world.getNationById(id),
        getTroopById: (id) => world.getTroopById(id),
        getDiplomacyEntry: (srcNationId, destNationId) =>
            diplomacyOverrides.get(buildDiplomacyKey(srcNationId, destNationId)) ??
            world.getDiplomacyEntry(srcNationId, destNationId),
        listGenerals: () =>
            mergeList(world.listGenerals(), generalOverrides).map((general) => ({
                ...general,
            })),
        listCities: () =>
            mergeList(world.listCities(), cityOverrides).map((city) => ({
                ...city,
            })),
        listNations: () =>
            mergeList(world.listNations(), nationOverrides).map((nation) => ({
                ...nation,
            })),
        listTroops: () => world.listTroops().map((troop) => ({ ...troop })),
        listDiplomacy: () =>
            mergeDiplomacyList(world.listDiplomacy(), diplomacyOverrides).map((entry) => ({
                ...entry,
                meta: { ...entry.meta },
            })),
    };

    return {
        view,
        syncGeneral: (general: TurnGeneral) => {
            generalOverrides.set(general.id, general);
        },
        syncCity: (city: City) => {
            cityOverrides.set(city.id, city);
        },
        syncNation: (nation: Nation) => {
            nationOverrides.set(nation.id, nation);
        },
        applyGeneralPatch: (id: number, patch: Partial<TurnGeneral>) => {
            const base = generalOverrides.get(id) ?? world.getGeneralById(id);
            if (!base) {
                return;
            }
            generalOverrides.set(id, applyGeneralPatch(base, patch));
        },
        applyCityPatch: (id: number, patch: Partial<City>) => {
            const base = cityOverrides.get(id) ?? world.getCityById(id);
            if (!base) {
                return;
            }
            cityOverrides.set(id, applyCityPatch(base, patch));
        },
        applyNationPatch: (id: number, patch: Partial<Nation>) => {
            const base = nationOverrides.get(id) ?? world.getNationById(id);
            if (!base) {
                return;
            }
            nationOverrides.set(id, applyNationPatch(base, patch));
        },
        applyDiplomacyPatch: (srcNationId: number, destNationId: number, patch: DiplomacyPatch) => {
            const key = buildDiplomacyKey(srcNationId, destNationId);
            const base =
                diplomacyOverrides.get(key) ??
                world.getDiplomacyEntry(srcNationId, destNationId) ??
                buildDefaultDiplomacy(srcNationId, destNationId);
            diplomacyOverrides.set(key, applyDiplomacyPatchToEntry(base, patch));
        },
    };
};

class WorldStateView implements StateView {
    constructor(
        private readonly world: WorldView | null,
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
            case 'generalList':
                return this.world.listGenerals();
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
            case 'nationList':
                return this.world.listNations();
            case 'destNation':
                return this.world.getNationById(req.id);
            case 'diplomacy':
                return this.world.getDiplomacyEntry(req.srcNationId, req.destNationId);
            case 'diplomacyList':
                return this.world.listDiplomacy();
            case 'arg':
                return this.args[req.key] ?? null;
            case 'env':
                return this.env[req.key] ?? null;
            default:
                return null;
        }
    }
}

const extractArgsRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

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

const createActionLog = (message: string, meta?: Record<string, unknown>): LogEntryDraft => ({
    scope: LogScope.GENERAL,
    category: LogCategory.ACTION,
    format: LogFormat.MONTH,
    text: message,
    meta,
});

const resolveDefinition = (
    actionKey: string,
    definitions: Map<string, GeneralActionDefinition>,
    fallback: GeneralActionDefinition
): GeneralActionDefinition => definitions.get(actionKey) ?? fallback;

export const createReservedTurnHandler = async (options: {
    reservedTurns: InMemoryReservedTurnStore;
    scenarioConfig: ScenarioConfig;
    scenarioMeta?: ScenarioMeta;
    map?: MapDefinition;
    unitSet?: UnitSetDefinition;
    getWorld: () => InMemoryTurnWorld | null;
    commandProfile?: TurnCommandProfile;
}): Promise<GeneralTurnHandler> => {
    const env = buildCommandEnv(options.scenarioConfig, options.unitSet);
    const commandProfile = options.commandProfile ?? DEFAULT_TURN_COMMAND_PROFILE;
    const { general: generalDefinitions, nation: nationDefinitions } = await buildReservedTurnDefinitions({
        env,
        commandProfile,
        defaultActionKey: DEFAULT_ACTION,
    });
    const generalFallback = generalDefinitions.get(DEFAULT_ACTION)!;
    const nationFallback = nationDefinitions.get(DEFAULT_ACTION)!;

    const actionContextBuilders = new Map<string, ActionContextBuilder>();
    const seenActionKeys = new Set<string>();
    const applyActionContextBuilder = (module: {
        commandSpec: { key: string };
        actionContextBuilder?: ActionContextBuilder;
    }): void => {
        actionContextBuilders.set(module.commandSpec.key, module.actionContextBuilder ?? defaultActionContextBuilder);
    };
    const generalModuleLoader = new GeneralTurnCommandLoader();
    const nationModuleLoader = new NationTurnCommandLoader();
    for (const key of commandProfile.general) {
        if (seenActionKeys.has(key)) {
            continue;
        }
        seenActionKeys.add(key);
        const module = await generalModuleLoader.load(key);
        applyActionContextBuilder(module);
    }
    for (const key of commandProfile.nation) {
        if (seenActionKeys.has(key)) {
            continue;
        }
        seenActionKeys.add(key);
        const module = await nationModuleLoader.load(key);
        applyActionContextBuilder(module);
    }
    if (!actionContextBuilders.has(DEFAULT_ACTION)) {
        applyActionContextBuilder(await generalModuleLoader.load(DEFAULT_ACTION));
    }

    let nextGeneralId: number | null = null;
    const createGeneralId = (): number => {
        const world = options.getWorld();
        if (world) {
            return world.getNextGeneralId();
        }

        if (nextGeneralId === null) {
            nextGeneralId = 1;
        }
        const result = nextGeneralId;
        nextGeneralId += 1;
        return result;
    };

    let nextNationId: number | null = null;
    const createNationId = (): number => {
        const world = options.getWorld();
        if (world) {
            return world.getNextNationId();
        }

        if (nextNationId === null) {
            nextNationId = 1;
        }
        const result = nextNationId;
        nextNationId += 1;
        return result;
    };

    const reservedTurnProvider: AiReservedTurnProvider = {
        getGeneralTurn: (generalId, turnIdx) => options.reservedTurns.getGeneralTurn(generalId, turnIdx),
    };

    return {
        execute(context): GeneralTurnResult {
            const worldRef = options.getWorld();
            const worldOverlay = worldRef ? createWorldOverlay(worldRef) : null;
            const worldView = worldOverlay?.view ?? worldRef;
            const baseConstraintEnv = {
                ...resolveConstraintEnv(context.world, options.scenarioMeta, env.openingPartYear),
                ...(options.map ? { map: options.map } : {}),
                ...(options.unitSet ? { unitSet: options.unitSet } : {}),
            };
            const logs: LogEntryDraft[] = [];
            const patches = {
                generals: [] as Array<{ id: number; patch: Partial<TurnGeneral> }>,
                cities: [] as Array<{ id: number; patch: Partial<City> }>,
                nations: [] as Array<{ id: number; patch: Partial<Nation> }>,
                troops: [] as Array<{ id: number; patch: Partial<Troop> }>,
            };
            const diplomacyPatches: Array<{
                srcNationId: number;
                destNationId: number;
                patch: DiplomacyPatch;
            }> = [];
            const createdGenerals: TurnGeneral[] = [];
            const createdNations: Nation[] = [];

            let currentGeneral = context.general;
            let currentCity = context.city;
            let currentNation = context.nation ?? null;

            const runAction = (
                definitionMap: Map<string, GeneralActionDefinition>,
                fallbackDefinition: GeneralActionDefinition,
                command: ReservedTurnEntry,
                applyNextTurnAt: boolean
            ): Date | undefined => {
                const resolvedDefinition = resolveDefinition(command.action, definitionMap, fallbackDefinition);
                const rawArgs = extractArgsRecord(command.args);
                const parsedArgs = resolvedDefinition.parseArgs(rawArgs);
                let definition = resolvedDefinition;
                let actionArgs = parsedArgs ?? {};
                let actionKey = definition.key;

                if (parsedArgs === null) {
                    definition = fallbackDefinition;
                    actionArgs = definition.parseArgs({}) ?? {};
                    actionKey = definition.key;
                    logs.push(createActionLog('예약된 명령을 실행하지 못했습니다.'));
                }

                const actionConstraintEnv = {
                    ...baseConstraintEnv,
                    cities: worldView?.listCities() ?? [],
                    nations: worldView?.listNations() ?? [],
                };
                const constraintCtx = buildConstraintContext(
                    currentGeneral,
                    currentCity,
                    currentNation,
                    actionArgs as Record<string, unknown>,
                    actionConstraintEnv
                );
                const view = new WorldStateView(worldView, actionConstraintEnv, actionArgs as Record<string, unknown>, {
                    general: currentGeneral,
                    city: currentCity,
                    nation: currentNation,
                });
                const constraints = definition.buildConstraints(constraintCtx, actionArgs);
                const result = evaluateConstraints(constraints, constraintCtx, view);
                if (result.kind !== 'allow') {
                    definition = fallbackDefinition;
                    actionArgs = definition.parseArgs({}) ?? {};
                    actionKey = definition.key;
                    const reason = result.kind === 'deny' ? result.reason : '조건을 확인할 수 없습니다.';
                    const meta = result.kind === 'deny' ? { constraintName: result.constraintName } : undefined;
                    logs.push(createActionLog(reason, meta));
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
                let specificContext = buildActionContext(
                    actionKey,
                    baseContext,
                    {
                        world: context.world,
                        scenarioConfig: options.scenarioConfig,
                        scenarioMeta: options.scenarioMeta,
                        map: options.map,
                        unitSet: options.unitSet,
                        worldRef: worldView,
                        actionArgs: actionArgsRecord,
                        createGeneralId,
                        createNationId,
                        seedBase,
                    },
                    actionContextBuilders
                );
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
                    actionContext,
                    {
                        now: currentGeneral.turnTime,
                        schedule: context.schedule,
                    },
                    actionArgs
                );

                currentGeneral = resolution.general as TurnGeneral;
                currentCity = resolution.city ?? currentCity;
                currentNation = resolution.nation ?? currentNation;

                if (!currentNation && resolution.created?.nations) {
                    currentNation =
                        (resolution.created.nations as Nation[]).find((n) => n.id === currentGeneral.nationId) ??
                        currentNation;
                }

                logs.push(...resolution.logs);
                if (worldOverlay) {
                    worldOverlay.syncGeneral(currentGeneral);
                    if (currentCity) {
                        worldOverlay.syncCity(currentCity);
                    }
                    if (currentNation) {
                        worldOverlay.syncNation(currentNation);
                    }
                }

                if (resolution.effects.length > 0) {
                    for (const effect of resolution.effects) {
                        if (effect.type !== 'diplomacy:patch') {
                            continue;
                        }
                        diplomacyPatches.push({
                            srcNationId: effect.srcNationId,
                            destNationId: effect.destNationId,
                            patch: effect.patch,
                        });
                        worldOverlay?.applyDiplomacyPatch(effect.srcNationId, effect.destNationId, effect.patch);
                    }
                }

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
                    if (worldOverlay) {
                        for (const patch of resolution.patches.generals) {
                            worldOverlay.applyGeneralPatch(patch.id, patch.patch as Partial<TurnGeneral>);
                        }
                        for (const patch of resolution.patches.cities) {
                            worldOverlay.applyCityPatch(patch.id, patch.patch);
                        }
                        for (const patch of resolution.patches.nations) {
                            worldOverlay.applyNationPatch(patch.id, patch.patch);
                        }
                    }
                }

                if (resolution.created?.generals) {
                    const newGenerals = resolution.created.generals as TurnGeneral[];
                    createdGenerals.push(...newGenerals);
                    if (worldOverlay) {
                        for (const general of newGenerals) {
                            worldOverlay.syncGeneral(general);
                        }
                    }
                }
                if (resolution.created?.nations) {
                    const newNations = resolution.created.nations as Nation[];
                    createdNations.push(...newNations);
                    if (worldOverlay) {
                        for (const nation of newNations) {
                            worldOverlay.syncNation(nation);
                        }
                    }
                }

                return applyNextTurnAt ? resolution.nextTurnAt : undefined;
            };

            if (currentNation && currentGeneral.officerLevel >= 5) {
                let nationCommand = options.reservedTurns.getNationTurn(
                    currentNation.id,
                    currentGeneral.officerLevel,
                    0
                );
                if (worldView && shouldUseAi(currentGeneral, context.world)) {
                    const ai = new GeneralAI({
                        general: currentGeneral,
                        city: currentCity,
                        nation: currentNation,
                        world: context.world,
                        worldRef: worldView,
                        reservedTurnProvider,
                        scenarioConfig: options.scenarioConfig,
                        scenarioMeta: options.scenarioMeta,
                        map: options.map,
                        unitSet: options.unitSet,
                        commandEnv: env,
                        generalDefinitions,
                        nationDefinitions,
                        generalFallback,
                        nationFallback,
                    });
                    const candidate = ai.chooseNationTurn(nationCommand);
                    if (candidate) {
                        nationCommand = { action: candidate.action, args: candidate.args };
                    }
                }
                runAction(nationDefinitions, nationFallback, nationCommand, false);
                options.reservedTurns.shiftNationTurns(currentNation.id, currentGeneral.officerLevel, -1);
            }

            let generalCommand = options.reservedTurns.getGeneralTurn(currentGeneral.id, 0);
            if (worldView && shouldUseAi(currentGeneral, context.world)) {
                const ai = new GeneralAI({
                    general: currentGeneral,
                    city: currentCity,
                    nation: currentNation,
                    world: context.world,
                    worldRef: worldView,
                    reservedTurnProvider,
                    scenarioConfig: options.scenarioConfig,
                    scenarioMeta: options.scenarioMeta,
                    map: options.map,
                    unitSet: options.unitSet,
                    commandEnv: env,
                    generalDefinitions,
                    nationDefinitions,
                    generalFallback,
                    nationFallback,
                });
                const candidate = ai.chooseGeneralTurn(generalCommand);
                if (candidate) {
                    generalCommand = { action: candidate.action, args: candidate.args };
                }
            }
            const nextTurnAt = runAction(generalDefinitions, generalFallback, generalCommand, true);
            options.reservedTurns.shiftGeneralTurns(currentGeneral.id, -1);

            const result: GeneralTurnResult = {
                general: currentGeneral,
                city: currentCity,
                nation: currentNation,
                nextTurnAt,
                logs,
                patches,
                ...(diplomacyPatches.length > 0 ? { diplomacyPatches } : undefined),
                created:
                    createdGenerals.length > 0 || createdNations.length > 0
                        ? {
                              generals: createdGenerals,
                              ...(createdNations.length > 0 ? { nations: createdNations } : {}),
                          }
                        : undefined,
            };

            return result;
        },
    };
};
