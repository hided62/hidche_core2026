import type {
    ActionContextBase,
    ActionContextBuilder,
    City,
    GeneralActionDefinition,
    LogEntryDraft,
    MapDefinition,
    MessageDraft,
    Nation,
    ScenarioConfig,
    ScenarioMeta,
    Troop,
    TurnCommandProfile,
    TurnCommandEnv,
    UnitSetDefinition,
} from '@sammo-ts/logic';
import {
    DEFAULT_TURN_COMMAND_PROFILE,
    GeneralTurnCommandLoader,
    GeneralActionPipeline,
    NationTurnCommandLoader,
    createGeneralTriggerContext,
    defaultActionContextBuilder,
    evaluateConstraints,
    resolveGeneralAction,
    ITEM_KEYS,
    buildGenericUniqueSeed,
    countOccupiedUniqueItems,
    createItemModuleRegistry,
    loadItemModules,
    resolveUniqueConfig,
    rollUniqueLottery,
    type ItemModule,
    type UniqueLotteryRunner,
} from '@sammo-ts/logic';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic';
import { asRecord, LiteHashDRBG, RandUtil } from '@sammo-ts/common';

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
import { buildFrontStatePatches } from './frontStateHandler.js';
import { buildActionContext } from './reservedTurnActionContext.js';
import { GeneralAI, shouldUseAi } from './ai/generalAi.js';
import type { AiReservedTurnProvider } from './ai/types.js';

const DEFAULT_ACTION = '휴식';

const resolveConstraintEnv = (
    world: TurnWorldState,
    scenarioMeta: ScenarioMeta | undefined,
    env: TurnCommandEnv
): Record<string, unknown> => {
    const worldMeta = asRecord(world.meta);
    const startYear = typeof scenarioMeta?.startYear === 'number' ? scenarioMeta.startYear : undefined;
    const relYear = typeof startYear === 'number' ? world.currentYear - startYear : undefined;
    const joinModeRaw = worldMeta.join_mode ?? worldMeta.joinMode;
    const joinMode = joinModeRaw === 'onlyRandom' ? 'onlyRandom' : 'full';
    const killturnRaw = worldMeta.killturn;
    const killturn =
        typeof killturnRaw === 'number'
            ? killturnRaw
            : typeof killturnRaw === 'string'
              ? Number(killturnRaw)
              : undefined;

    return {
        ...env,
        currentYear: world.currentYear,
        currentMonth: world.currentMonth,
        year: world.currentYear,
        month: world.currentMonth,
        startYear,
        relYear,
        openingPartYear: env.openingPartYear,
        minAvailableRecruitPop: env.minAvailableRecruitPop,
        join_mode: joinMode,
        ...(Number.isFinite(killturn) ? { killturn } : {}),
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

const joinYearMonth = (year: number, month: number): number => year * 12 + month - 1;

type LegacyLastTurn = {
    command: string;
    arg?: Record<string, unknown>;
    term?: number;
    seq?: number;
};

const nationLastTurnKey = (officerLevel: number): string => `turn_last_${officerLevel}`;

const normalizeLastTurn = (value: unknown): LegacyLastTurn => {
    const raw = asRecord(value);
    return {
        command: typeof raw.command === 'string' ? raw.command : '휴식',
        ...(asRecord(raw.arg) && Object.keys(asRecord(raw.arg)).length > 0 ? { arg: asRecord(raw.arg) } : undefined),
        ...(typeof raw.term === 'number' && Number.isFinite(raw.term) ? { term: Math.floor(raw.term) } : undefined),
        ...(typeof raw.seq === 'number' && Number.isFinite(raw.seq) ? { seq: Math.floor(raw.seq) } : undefined),
    };
};

const sameArgs = (left: Record<string, unknown> | undefined, right: Record<string, unknown>): boolean =>
    JSON.stringify(left ?? {}) === JSON.stringify(right);

const readNextAvailableTurn = (nation: Nation, actionName: string): number | null => {
    const raw = asRecord(nation.meta)[`next_execute_${actionName}`];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return Math.floor(raw);
    }
    if (typeof raw === 'string') {
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? Math.floor(parsed) : null;
    }
    return null;
};

const readGeneralNextAvailableTurn = (general: TurnGeneral, actionName: string): number | null => {
    const raw = asRecord(general.meta)[`next_execute_${actionName}`];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return Math.floor(raw);
    }
    if (typeof raw === 'string') {
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? Math.floor(parsed) : null;
    }
    return null;
};

const readMetaNumber = (meta: Record<string, unknown>, key: string, fallback: number): number => {
    const value = meta[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.floor(value);
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return Math.floor(parsed);
        }
    }
    return fallback;
};

const readMetaBool = (meta: Record<string, unknown>, key: string, fallback = false): boolean => {
    const value = meta[key];
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return value !== 0;
    }
    if (typeof value === 'string') {
        const lowered = value.toLowerCase();
        if (lowered === 'true' || lowered === '1') {
            return true;
        }
        if (lowered === 'false' || lowered === '0') {
            return false;
        }
    }
    return fallback;
};

const resolveStartYear = (world: TurnWorldState, scenarioMeta?: ScenarioMeta): number => {
    if (typeof scenarioMeta?.startYear === 'number') {
        return scenarioMeta.startYear;
    }
    const worldMeta = asRecord(world.meta);
    const scenarioMetaRecord = asRecord(worldMeta.scenarioMeta);
    return readMetaNumber(scenarioMetaRecord, 'startYear', world.currentYear);
};

const buildUniqueLotteryRunner = (options: {
    world: TurnWorldState;
    worldView: WorldView | null;
    scenarioMeta?: ScenarioMeta;
    seedBase: string;
    itemRegistry: Map<string, ItemModule>;
    uniqueConfig: ReturnType<typeof resolveUniqueConfig>;
}): UniqueLotteryRunner => {
    if (!options.worldView) {
        return () => null;
    }
    const worldView = options.worldView;
    const world = options.world;
    const worldMeta = asRecord(world.meta);
    const startYear = resolveStartYear(world, options.scenarioMeta);
    const initYear = readMetaNumber(worldMeta, 'initYear', startYear);
    const initMonth = readMetaNumber(worldMeta, 'initMonth', 1);
    const scenarioId = readMetaNumber(worldMeta, 'scenarioId', 0);
    const minMonthToAllowInherit = options.uniqueConfig.minMonthToAllowInheritItem;

    return ({ acquireType, reason, general }) => {
        if (general.npcState >= 2) {
            return null;
        }
        const allGenerals = worldView.listGenerals();
        const userCount = allGenerals.filter((entry) => entry.npcState < 2).length;
        if (userCount <= 0) {
            return null;
        }
        const generalItemsList = allGenerals.map((entry) =>
            entry.id === general.id ? general.role.items : entry.role.items
        );
        const occupiedUniqueCounts = countOccupiedUniqueItems(generalItemsList, options.itemRegistry);
        const rngSeed = buildGenericUniqueSeed(
            options.seedBase,
            world.currentYear,
            world.currentMonth,
            general.id,
            reason
        );
        const rng = new RandUtil(LiteHashDRBG.build(rngSeed));
        const inheritRandomUnique = readMetaBool(asRecord(general.meta), 'inheritRandomUnique', false);
        const relMonthByInit =
            joinYearMonth(world.currentYear, world.currentMonth) - joinYearMonth(initYear, initMonth);
        const availableBuyUnique = relMonthByInit >= minMonthToAllowInherit;
        const itemKey = rollUniqueLottery({
            rng,
            config: options.uniqueConfig,
            itemRegistry: options.itemRegistry,
            generalItems: general.role.items,
            occupiedUniqueCounts,
            scenarioId,
            userCount,
            currentYear: world.currentYear,
            currentMonth: world.currentMonth,
            startYear,
            initYear,
            initMonth,
            acquireType,
            inheritRandomUnique,
        });
        if (!itemKey) {
            return null;
        }
        if (inheritRandomUnique && availableBuyUnique) {
            delete asRecord(general.meta).inheritRandomUnique;
        }
        return options.itemRegistry.get(itemKey) ?? null;
    };
};

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

const extractArgsRecord = (value: unknown): Record<string, unknown> => asRecord(value);

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
    onActionResolved?: (payload: {
        kind: 'nation' | 'general';
        generalId: number;
        nationId: number | null;
        requestedAction: string;
        actionKey: string;
        usedFallback: boolean;
        blockedReason?: string;
        aiState?: ReturnType<GeneralAI['getDebugState']>;
    }) => void;
}): Promise<GeneralTurnHandler> => {
    const env = buildCommandEnv(options.scenarioConfig, options.unitSet);
    const itemRegistry = createItemModuleRegistry(await loadItemModules([...ITEM_KEYS]));
    const uniqueConfig = resolveUniqueConfig(asRecord(options.scenarioConfig.const));
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
                ...resolveConstraintEnv(context.world, options.scenarioMeta, env),
                ...(options.map ? { map: options.map } : {}),
                ...(options.unitSet ? { unitSet: options.unitSet } : {}),
            };
            const logs: LogEntryDraft[] = [];
            const messages: MessageDraft[] = [];
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
                kind: 'nation' | 'general',
                definitionMap: Map<string, GeneralActionDefinition>,
                fallbackDefinition: GeneralActionDefinition,
                command: ReservedTurnEntry,
                applyNextTurnAt: boolean,
                alternativeDepth = 0
            ): { nextTurnAt?: Date; actionKey: string; usedFallback: boolean; blockedReason?: string } => {
                const resolvedDefinition = resolveDefinition(command.action, definitionMap, fallbackDefinition);
                const rawArgs = extractArgsRecord(command.args);
                const parsedArgs = resolvedDefinition.parseArgs(rawArgs);
                let definition = resolvedDefinition;
                let actionArgs = parsedArgs ?? {};
                let actionKey = definition.key;
                let usedFallback = false;
                let blockedReason: string | undefined = undefined;

                if (parsedArgs === null) {
                    definition = fallbackDefinition;
                    actionArgs = definition.parseArgs({}) ?? {};
                    actionKey = definition.key;
                    usedFallback = true;
                    blockedReason = '예약된 명령을 실행하지 못했습니다.';
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
                    usedFallback = true;
                    const reason = result.kind === 'deny' ? result.reason : '조건을 확인할 수 없습니다.';
                    blockedReason = reason;
                    const meta = result.kind === 'deny' ? { constraintName: result.constraintName } : undefined;
                    logs.push(createActionLog(reason, meta));
                }
                if (!usedFallback && (kind === 'general' || currentNation)) {
                    const currentYearMonth = joinYearMonth(context.world.currentYear, context.world.currentMonth);
                    const nextAvailableTurn =
                        kind === 'general'
                            ? readGeneralNextAvailableTurn(currentGeneral, definition.name)
                            : readNextAvailableTurn(currentNation!, definition.name);
                    if (nextAvailableTurn !== null && currentYearMonth < nextAvailableTurn) {
                        const remainTurn = nextAvailableTurn - currentYearMonth;
                        definition = fallbackDefinition;
                        actionArgs = definition.parseArgs({}) ?? {};
                        actionKey = definition.key;
                        usedFallback = true;
                        blockedReason = `${remainTurn}턴 더 기다려야 합니다`;
                        logs.push(createActionLog(blockedReason));
                    }
                }

                const seedBase = buildSeedBase(context.world);
                const buildRng = (key: string) => {
                    const rngSeed = serializeSeed(
                        seedBase,
                        kind === 'general' ? 'generalCommand' : 'nationCommand',
                        context.world.currentYear,
                        context.world.currentMonth,
                        currentGeneral.id,
                        key
                    );
                    return new RandUtil(new LiteHashDRBG(rngSeed));
                };

                const actionArgsRecord = extractArgsRecord(actionArgs);
                const uniqueLottery = buildUniqueLotteryRunner({
                    world: context.world,
                    worldView,
                    scenarioMeta: options.scenarioMeta,
                    seedBase,
                    itemRegistry,
                    uniqueConfig,
                });
                let baseContext: ActionContextBase = {
                    general: currentGeneral,
                    city: currentCity,
                    nation: currentNation,
                    rng: buildRng(actionKey),
                    uniqueLottery,
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
                    usedFallback = true;
                    blockedReason = '예약된 명령을 실행하지 못했습니다.';
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
                const executionDefinition = definition as unknown as {
                    getPreReqTurn?: (context: ActionContextBase, args: unknown) => number;
                    getPostReqTurn?: (context: ActionContextBase, args: unknown) => number;
                    getStackSequence?: (context: ActionContextBase, args: unknown) => number | null;
                    getProgressText?: (
                        context: ActionContextBase,
                        args: unknown,
                        term: number,
                        termMax: number
                    ) => string;
                    getInheritanceActiveActionAmount?: (context: ActionContextBase, args: unknown) => number;
                };
                const preReqTurn = !usedFallback
                    ? Math.max(0, Math.floor(executionDefinition.getPreReqTurn?.(actionContext, actionArgs) ?? 0))
                    : 0;
                const postReqTurn = !usedFallback
                    ? Math.max(0, Math.floor(executionDefinition.getPostReqTurn?.(actionContext, actionArgs) ?? 0))
                    : 0;

                if (!usedFallback && preReqTurn > 0 && (kind === 'general' || currentNation)) {
                    const metaKey = nationLastTurnKey(currentGeneral.officerLevel);
                    const lastTurn =
                        kind === 'general'
                            ? normalizeLastTurn(currentGeneral.lastTurn)
                            : normalizeLastTurn(asRecord(currentNation!.meta)[metaKey]);
                    const stackSequence = executionDefinition.getStackSequence?.(actionContext, actionArgs) ?? null;
                    const sequenceChanged =
                        stackSequence !== null && (lastTurn.seq === undefined || lastTurn.seq < stackSequence);
                    const continuing =
                        lastTurn.command === definition.name &&
                        sameArgs(lastTurn.arg, actionArgsRecord) &&
                        !sequenceChanged;
                    const nextTerm = continuing ? (lastTurn.term ?? 0) + 1 : 1;

                    if (!continuing || (lastTurn.term ?? 0) < preReqTurn) {
                        const nextLastTurn: LegacyLastTurn = {
                            command: definition.name,
                            ...(Object.keys(actionArgsRecord).length > 0 ? { arg: actionArgsRecord } : undefined),
                            term: nextTerm,
                            ...(stackSequence !== null ? { seq: stackSequence } : undefined),
                        };
                        if (kind === 'general') {
                            currentGeneral = {
                                ...currentGeneral,
                                lastTurn: nextLastTurn,
                            };
                            worldOverlay?.syncGeneral(currentGeneral);
                        } else {
                            const nextNation: Nation = {
                                ...currentNation!,
                                meta: {
                                    ...currentNation!.meta,
                                    [metaKey]: nextLastTurn,
                                } as Nation['meta'],
                            };
                            currentNation = nextNation;
                            worldOverlay?.syncNation(nextNation);
                        }
                        const termMax = preReqTurn + 1;
                        const progressText =
                            executionDefinition.getProgressText?.(actionContext, actionArgs, nextTerm, termMax) ??
                            `${definition.name} 수행중... (${nextTerm}/${termMax})`;
                        logs.push(createActionLog(progressText));
                        return { actionKey, usedFallback, blockedReason };
                    }
                }

                const lastTurnBeforeExecution = JSON.stringify(currentGeneral.lastTurn ?? {});
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
                if (
                    !resolution.alternative &&
                    kind === 'nation' &&
                    !usedFallback &&
                    definition.countsAsInheritanceActiveAction
                ) {
                    const meta = { ...currentGeneral.meta };
                    const active = typeof meta.inherit_active_action === 'number' ? meta.inherit_active_action : 0;
                    meta.inherit_active_action = active + 1;
                    currentGeneral = { ...currentGeneral, meta };
                }
                if (
                    !resolution.alternative &&
                    kind === 'general' &&
                    !usedFallback &&
                    executionDefinition.getInheritanceActiveActionAmount
                ) {
                    const amount = executionDefinition.getInheritanceActiveActionAmount(actionContext, actionArgs);
                    if (Number.isFinite(amount) && amount !== 0) {
                        const meta = { ...currentGeneral.meta };
                        const active = typeof meta.inherit_active_action === 'number' ? meta.inherit_active_action : 0;
                        meta.inherit_active_action = active + amount;
                        currentGeneral = { ...currentGeneral, meta };
                    }
                }

                if (!currentNation && resolution.created?.nations) {
                    currentNation =
                        (resolution.created.nations as Nation[]).find((n) => n.id === currentGeneral.nationId) ??
                        currentNation;
                }
                if (!resolution.alternative && kind === 'general' && !usedFallback) {
                    const actionChangedLastTurn =
                        JSON.stringify(currentGeneral.lastTurn ?? {}) !== lastTurnBeforeExecution;
                    const nextMeta = { ...currentGeneral.meta };
                    if (postReqTurn > 0) {
                        nextMeta[`next_execute_${definition.name}`] =
                            joinYearMonth(context.world.currentYear, context.world.currentMonth) +
                            postReqTurn -
                            preReqTurn;
                    }
                    currentGeneral = {
                        ...currentGeneral,
                        meta: nextMeta,
                        lastTurn: actionChangedLastTurn
                            ? currentGeneral.lastTurn
                            : {
                                  command: definition.name,
                                  ...(Object.keys(actionArgsRecord).length > 0 ? { arg: actionArgsRecord } : undefined),
                              },
                    };
                }
                if (!resolution.alternative && kind === 'nation' && !usedFallback && currentNation) {
                    const metaKey = nationLastTurnKey(currentGeneral.officerLevel);
                    const nextMeta: Record<string, unknown> = {
                        ...currentNation.meta,
                        [metaKey]: {
                            command: definition.name,
                            ...(Object.keys(actionArgsRecord).length > 0 ? { arg: actionArgsRecord } : undefined),
                            term: 0,
                        } satisfies LegacyLastTurn,
                    };
                    if (postReqTurn > 0) {
                        nextMeta[`next_execute_${definition.name}`] =
                            joinYearMonth(context.world.currentYear, context.world.currentMonth) +
                            postReqTurn -
                            preReqTurn;
                    }
                    currentNation = {
                        ...currentNation,
                        meta: nextMeta as Nation['meta'],
                    };
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
                        if (effect.type === 'message:add') {
                            messages.push(effect.draft);
                        } else if (effect.type === 'diplomacy:patch') {
                            diplomacyPatches.push({
                                srcNationId: effect.srcNationId,
                                destNationId: effect.destNationId,
                                patch: effect.patch,
                            });
                            worldOverlay?.applyDiplomacyPatch(effect.srcNationId, effect.destNationId, effect.patch);
                        }
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

                const hasDiplomacyChange = diplomacyPatches.length > 0;
                const hasNationChange = (resolution.patches?.cities ?? []).some((patch) =>
                    Object.prototype.hasOwnProperty.call(patch.patch ?? {}, 'nationId')
                );
                if (hasDiplomacyChange || hasNationChange) {
                    const worldView = worldOverlay?.view ?? worldRef;
                    if (worldView && options.map) {
                        const frontPatches = buildFrontStatePatches({
                            worldView,
                            map: options.map,
                        });
                        if (frontPatches.length > 0) {
                            for (const patch of frontPatches) {
                                const existing = patches.cities.find((entry) => entry.id === patch.id);
                                if (existing) {
                                    existing.patch = { ...existing.patch, ...patch.patch };
                                } else {
                                    patches.cities.push({ id: patch.id, patch: patch.patch });
                                }
                                worldOverlay?.applyCityPatch(patch.id, patch.patch);
                            }
                        }
                    }
                }

                if (resolution.alternative) {
                    if (alternativeDepth >= 5) {
                        throw new Error('Command fallback loop limit exceeded');
                    }
                    return runAction(
                        kind,
                        definitionMap,
                        fallbackDefinition,
                        {
                            action: resolution.alternative.commandKey,
                            args: extractArgsRecord(resolution.alternative.args),
                        },
                        applyNextTurnAt,
                        alternativeDepth + 1
                    );
                }

                return {
                    nextTurnAt: applyNextTurnAt ? resolution.nextTurnAt : undefined,
                    actionKey,
                    usedFallback,
                    blockedReason,
                };
            };

            const preprocessRng = new RandUtil(
                new LiteHashDRBG(
                    serializeSeed(
                        buildSeedBase(context.world),
                        'preprocess',
                        context.world.currentYear,
                        context.world.currentMonth,
                        currentGeneral.id
                    )
                )
            );
            currentGeneral = {
                ...currentGeneral,
                role: {
                    ...currentGeneral.role,
                    items: { ...currentGeneral.role.items },
                },
                meta: { ...currentGeneral.meta },
                triggerState: {
                    ...currentGeneral.triggerState,
                    flags: { ...currentGeneral.triggerState.flags },
                    counters: { ...currentGeneral.triggerState.counters },
                    modifiers: { ...currentGeneral.triggerState.modifiers },
                    meta: { ...currentGeneral.triggerState.meta },
                },
            };
            if (currentGeneral.npcState < 2) {
                const lived =
                    typeof currentGeneral.meta.inherit_lived_month === 'number'
                        ? currentGeneral.meta.inherit_lived_month
                        : 0;
                currentGeneral.meta.inherit_lived_month = lived + 1;
            }
            currentCity = currentCity ? { ...currentCity, meta: { ...currentCity.meta } } : currentCity;
            const preTurnPipeline = new GeneralActionPipeline(env.generalActionModules ?? []);
            const preTurnContext = createGeneralTriggerContext({
                general: currentGeneral,
                nation: currentNation,
                worldView: worldView ?? undefined,
                rng: preprocessRng,
                log: {
                    push: (message: string) => logs.push(createActionLog(message)),
                },
            });
            preTurnPipeline.getPreTurnExecuteTriggerList(preTurnContext).fire(preTurnContext, baseConstraintEnv);
            if (currentGeneral.injury > 0 && !preTurnContext.skill.has('pre.부상경감')) {
                currentGeneral.injury = Math.max(0, currentGeneral.injury - 10);
                preTurnContext.skill.activate('pre.부상경감');
            }
            if (currentGeneral.crew >= 100) {
                const consumeRice = Math.trunc(currentGeneral.crew / 100);
                if (consumeRice <= currentGeneral.rice) {
                    currentGeneral.rice -= consumeRice;
                } else {
                    const releasedCrew = preTurnPipeline.onCalcDomestic(
                        preTurnContext,
                        '징집인구',
                        'score',
                        currentGeneral.crew
                    );
                    if (currentCity) {
                        currentCity.population += releasedCrew;
                    }
                    currentGeneral.crew = 0;
                    currentGeneral.rice = 0;
                    logs.push(createActionLog('군량이 모자라 병사들이 <R>소집해제</>되었습니다!'));
                    preTurnContext.skill.activate('pre.소집해제');
                }
                preTurnContext.skill.activate('pre.병력군량소모');
            }
            worldOverlay?.syncGeneral(currentGeneral);
            if (currentCity) {
                worldOverlay?.syncCity(currentCity);
            }

            const blockCode = typeof currentGeneral.meta.block === 'number' ? Math.trunc(currentGeneral.meta.block) : 0;
            const isBlocked = blockCode === 2 || blockCode === 3;
            if (isBlocked) {
                currentGeneral.meta.killturn = Math.max(
                    0,
                    typeof currentGeneral.meta.killturn === 'number' ? currentGeneral.meta.killturn - 1 : 0
                );
                logs.push(
                    createActionLog(
                        blockCode === 2
                            ? '현재 멀티, 또는 비매너로 인한<R>블럭</> 대상자입니다.'
                            : '현재 악성유저로 분류되어 <R>블럭</> 대상자입니다.'
                    )
                );
            }

            if (!isBlocked && currentNation && currentGeneral.officerLevel >= 5) {
                let nationCommand = options.reservedTurns.getNationTurn(
                    currentNation.id,
                    currentGeneral.officerLevel,
                    0
                );
                let nationAiState: ReturnType<GeneralAI['getDebugState']> | undefined;
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
                    nationAiState = ai.getDebugState();
                }
                const nationResult = runAction('nation', nationDefinitions, nationFallback, nationCommand, false);
                options.onActionResolved?.({
                    kind: 'nation',
                    generalId: currentGeneral.id,
                    nationId: currentNation?.id ?? null,
                    requestedAction: nationCommand.action,
                    actionKey: nationResult.actionKey,
                    usedFallback: nationResult.usedFallback,
                    ...(nationResult.blockedReason ? { blockedReason: nationResult.blockedReason } : {}),
                    ...(nationAiState ? { aiState: nationAiState } : {}),
                });
                options.reservedTurns.shiftNationTurns(currentNation.id, currentGeneral.officerLevel, -1);
            }
            if (isBlocked && currentNation && currentGeneral.officerLevel >= 5) {
                options.reservedTurns.shiftNationTurns(currentNation.id, currentGeneral.officerLevel, -1);
            }

            let generalCommand = options.reservedTurns.getGeneralTurn(currentGeneral.id, 0);
            let generalAiState: ReturnType<GeneralAI['getDebugState']> | undefined;
            let generalAutorunMode = false;
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
                    generalAutorunMode =
                        candidate.action !== generalCommand.action ||
                        JSON.stringify(candidate.args ?? {}) !== JSON.stringify(generalCommand.args ?? {});
                    generalCommand = { action: candidate.action, args: candidate.args };
                }
                generalAiState = ai.getDebugState();
            }
            const generalResult = isBlocked
                ? {
                      actionKey: DEFAULT_ACTION,
                      usedFallback: true,
                      blockedReason: '블럭 대상자입니다.',
                  }
                : runAction('general', generalDefinitions, generalFallback, generalCommand, true);
            options.onActionResolved?.({
                kind: 'general',
                generalId: currentGeneral.id,
                nationId: currentNation?.id ?? null,
                requestedAction: generalCommand.action,
                actionKey: generalResult.actionKey,
                usedFallback: generalResult.usedFallback,
                ...(generalResult.blockedReason ? { blockedReason: generalResult.blockedReason } : {}),
                ...(generalAiState ? { aiState: generalAiState } : {}),
            });
            const nextTurnAt = generalResult.nextTurnAt;
            options.reservedTurns.shiftGeneralTurns(currentGeneral.id, -1);

            if (!isBlocked) {
                const meta = { ...currentGeneral.meta };
                const currentKillturn =
                    typeof meta.killturn === 'number' && Number.isFinite(meta.killturn) ? meta.killturn : 0;
                const worldKillturn = readMetaNumber(asRecord(context.world.meta), 'killturn', currentKillturn);
                const requestedRest = generalCommand.action === DEFAULT_ACTION;
                if (
                    currentGeneral.npcState >= 2 ||
                    currentKillturn > worldKillturn ||
                    generalAutorunMode ||
                    requestedRest
                ) {
                    meta.killturn = Math.max(0, currentKillturn - 1);
                } else {
                    meta.killturn = worldKillturn;
                }
                currentGeneral = { ...currentGeneral, meta };
                worldOverlay?.syncGeneral(currentGeneral);
            }
            currentGeneral = {
                ...currentGeneral,
                meta: {
                    ...currentGeneral.meta,
                    myset: Math.min(
                        9,
                        (typeof currentGeneral.meta.myset === 'number' ? currentGeneral.meta.myset : 0) + 3
                    ),
                },
            };
            currentGeneral = {
                ...currentGeneral,
                triggerState: {
                    ...currentGeneral.triggerState,
                    flags: {},
                },
            };

            const result: GeneralTurnResult = {
                general: currentGeneral,
                city: currentCity,
                nation: currentNation,
                nextTurnAt,
                logs,
                ...(messages.length > 0 ? { messages } : undefined),
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
