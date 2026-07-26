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
    addOccupiedUniqueItemKeys,
    buildGenericUniqueSeed,
    countOccupiedUniqueItems,
    createItemModuleRegistry,
    loadItemModules,
    resolveUniqueConfig,
    rollUniqueLottery,
    getNextTurnAt,
    getBillByLevel,
    type ItemModule,
    type UniqueLotteryRunner,
} from '@sammo-ts/logic';
import { buildLegacyDefaultUniqueItemPool } from '@sammo-ts/logic/rewards/legacyUniqueItemPool.js';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic';
import { asRecord, JosaUtil, LEGACY_RANK_DATA_TYPES, LiteHashDRBG, RandUtil } from '@sammo-ts/common';

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
import { rankMetaKey } from './rankData.js';

const DEFAULT_ACTION = '휴식';

const LEGACY_STAT_CHANGE_GENERAL_ACTIONS = new Set([
    'che_소집해제',
    'che_랜덤임관',
    'che_헌납',
    'che_강행',
    'che_정착장려',
    'che_숙련전환',
    'che_주민선정',
    'che_모반시도',
    'che_요양',
    'che_거병',
    'che_건국',
    'che_증여',
    'che_훈련',
    'che_견문',
    'che_무작위건국',
    'che_화계',
    'che_집합',
    'cr_건국',
    'che_이동',
    'cr_맹훈련',
    'che_인재탐색',
    'che_귀환',
    'che_사기진작',
    'che_군량매매',
    'che_기술연구',
    'che_첩보',
    'che_임관',
    'che_상업투자',
    'che_장비매매',
    'che_장수대상임관',
    'che_징병',
    'che_단련',
    'che_등용',
    'che_하야',
    'che_물자조달',
    'che_선양',
    'che_전투태세',
]);

const applyLegacyGeneralProgression = (
    general: TurnGeneral,
    previousGeneral: TurnGeneral,
    actionKey: string,
    env: TurnCommandEnv,
    logs: LogEntryDraft[]
): TurnGeneral => {
    const maxStatLevel = env.maxStatLevel ?? 255;
    const maxDedicationLevel = env.maxDedicationLevel ?? 30;
    const expLevel = Math.max(
        0,
        Math.min(
            maxStatLevel,
            general.experience < 1_000
                ? Math.trunc(general.experience / 100)
                : Math.trunc(Math.sqrt(general.experience / 10))
        )
    );
    const dedicationLevel = Math.max(0, Math.min(maxDedicationLevel, Math.ceil(Math.sqrt(general.dedication) / 10)));
    const meta = { ...general.meta };
    // 하야는 ref에서 addExperience(0)/addDedication(0)을 호출해 현재 값으로
    // 등급을 강제 재계산한다. 반대로 은퇴의 rebirth()와 선양의
    // multiplyVar('experience')는 수치를 줄이면서도 기존 등급을 그대로 둔다.
    const forceRefreshLevel = actionKey === 'che_하야';
    const preserveLevel = actionKey === 'che_은퇴' || actionKey === 'che_선양';
    if (!preserveLevel && (forceRefreshLevel || general.experience !== previousGeneral.experience)) {
        const previousExpLevel = readMetaNumber(previousGeneral.meta, 'explevel', 0);
        const actionResolvedExpLevel = readMetaNumber(general.meta, 'explevel', previousExpLevel);
        meta.explevel = expLevel;
        if (expLevel !== previousExpLevel && actionResolvedExpLevel !== expLevel) {
            const josaRo = JosaUtil.pick(String(expLevel), '로');
            logs.push({
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.PLAIN,
                text:
                    expLevel > previousExpLevel
                        ? `<C>Lv ${expLevel}</>${josaRo} <C>레벨업</>!`
                        : `<C>Lv ${expLevel}</>${josaRo} <R>레벨다운</>!`,
            });
        }
    }
    if (!preserveLevel && (forceRefreshLevel || general.dedication !== previousGeneral.dedication)) {
        const previousDedicationLevel = readMetaNumber(previousGeneral.meta, 'dedlevel', 0);
        meta.dedlevel = dedicationLevel;
        if (dedicationLevel !== previousDedicationLevel) {
            const dedicationLevelText =
                dedicationLevel === 0 ? '무품관' : `${maxDedicationLevel - dedicationLevel + 1}품관`;
            const billText = getBillByLevel(dedicationLevel).toLocaleString('en-US');
            const josaRoDedication = JosaUtil.pick(dedicationLevelText, '로');
            const josaRoBill = JosaUtil.pick(billText, '로');
            logs.push({
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                format: LogFormat.PLAIN,
                text:
                    dedicationLevel > previousDedicationLevel
                        ? `<Y>${dedicationLevelText}</>${josaRoDedication} <C>승급</>하여 봉록이 <C>${billText}</>${josaRoBill} <C>상승</>했습니다!`
                        : `<Y>${dedicationLevelText}</>${josaRoDedication} <R>강등</>되어 봉록이 <C>${billText}</>${josaRoBill} <R>하락</>했습니다!`,
            });
        }
    }

    if (!LEGACY_STAT_CHANGE_GENERAL_ACTIONS.has(actionKey)) {
        return { ...general, meta };
    }

    const stats = { ...general.stats };
    const limit = env.statUpgradeLimit ?? 30;
    const entries = [
        ['leadership', 'leadership_exp'],
        ['strength', 'strength_exp'],
        ['intelligence', 'intel_exp'],
    ] as const;
    for (const [statKey, expKey] of entries) {
        const rawExp = typeof meta[expKey] === 'number' ? meta[expKey] : 0;
        if (rawExp < 0) {
            meta[expKey] = rawExp + limit;
            stats[statKey] -= 1;
        } else if (rawExp >= limit) {
            if (stats[statKey] < maxStatLevel) {
                stats[statKey] += 1;
            }
            meta[expKey] = rawExp - limit;
        }
    }
    return { ...general, stats, meta };
};

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

const readConfigNumber = (config: ScenarioConfig, key: string, fallback: number): number => {
    const value = asRecord(config.const)[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

const cloneTurnGeneral = (general: TurnGeneral): TurnGeneral => ({
    ...general,
    stats: { ...general.stats },
    role: {
        ...general.role,
        items: { ...general.role.items },
    },
    meta: { ...general.meta },
    triggerState: {
        ...general.triggerState,
        flags: { ...general.triggerState.flags },
        counters: { ...general.triggerState.counters },
        modifiers: { ...general.triggerState.modifiers },
        meta: { ...general.triggerState.meta },
    },
});

const resetRetiredGeneral = (general: TurnGeneral): TurnGeneral => {
    const meta = { ...general.meta };
    for (const type of LEGACY_RANK_DATA_TYPES) {
        meta[rankMetaKey(type)] = 0;
    }
    meta.specage = 0;
    meta.specage2 = 0;
    for (let dex = 1; dex <= 5; dex += 1) {
        const key = `dex${dex}`;
        meta[key] = Math.round(readMetaNumber(meta, key, 0) * 0.5);
    }
    meta.inherit_lived_month = 0;
    meta.inherit_active_action = 0;

    return {
        ...general,
        stats: {
            leadership: Math.max(10, Math.round(general.stats.leadership * 0.85)),
            strength: Math.max(10, Math.round(general.stats.strength * 0.85)),
            intelligence: Math.max(10, Math.round(general.stats.intelligence * 0.85)),
        },
        injury: 0,
        experience: Math.round(general.experience * 0.5),
        dedication: Math.round(general.dedication * 0.5),
        age: 20,
        meta,
    };
};

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
    getAdditionalOccupiedUniqueItemKeys?: () => Iterable<string | null | undefined>;
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
        addOccupiedUniqueItemKeys(
            occupiedUniqueCounts,
            options.getAdditionalOccupiedUniqueItemKeys?.() ?? [],
            options.itemRegistry
        );
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

const withCanonicalArgumentAliases = (args: Record<string, unknown>): Record<string, unknown> => {
    const normalized = { ...args };
    for (const [legacyKey, canonicalKey] of [
        ['destCityID', 'destCityId'],
        ['destNationID', 'destNationId'],
        ['destGeneralID', 'destGeneralId'],
        ['destTroopID', 'destTroopId'],
    ] as const) {
        if (normalized[canonicalKey] === undefined && normalized[legacyKey] !== undefined) {
            normalized[canonicalKey] = normalized[legacyKey];
        }
    }
    return normalized;
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
    commandEnv?: TurnCommandEnv;
    commandRngFactory?: (input: { kind: 'nation' | 'general'; actionKey: string; seed: string }) => RandUtil;
    getAdditionalOccupiedUniqueItemKeys?: () => Iterable<string | null | undefined>;
    onActionResolved?: (payload: {
        kind: 'nation' | 'general';
        generalId: number;
        nationId: number | null;
        requestedAction: string;
        actionKey: string;
        usedFallback: boolean;
        completed?: boolean;
        blockedReason?: string;
        aiState?: ReturnType<GeneralAI['getDebugState']>;
    }) => void;
}): Promise<GeneralTurnHandler> => {
    const env = options.commandEnv ?? buildCommandEnv(options.scenarioConfig, options.unitSet);
    const itemRegistry = createItemModuleRegistry(await loadItemModules([...ITEM_KEYS]));
    const uniqueConfig = resolveUniqueConfig(asRecord(options.scenarioConfig.const));
    if (Object.keys(uniqueConfig.allItems).length === 0) {
        uniqueConfig.allItems = buildLegacyDefaultUniqueItemPool(itemRegistry);
    }
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
            const commandDeletedTroopIds = new Set<number>();

            let currentGeneral = context.general;
            let currentCity = context.city;
            let currentNation = context.nation ?? null;

            const runAction = (
                kind: 'nation' | 'general',
                definitionMap: Map<string, GeneralActionDefinition>,
                fallbackDefinition: GeneralActionDefinition,
                command: ReservedTurnEntry,
                applyNextTurnAt: boolean,
                alternativeDepth = 0,
                sharedActionRng?: RandUtil
            ): {
                nextTurnAt?: Date;
                actionKey: string;
                usedFallback: boolean;
                completed: boolean;
                blockedReason?: string;
            } => {
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
                const constraintArgs = withCanonicalArgumentAliases(actionArgs as Record<string, unknown>);
                const constraintCtx = buildConstraintContext(
                    currentGeneral,
                    currentCity,
                    currentNation,
                    constraintArgs,
                    actionConstraintEnv
                );
                const view = new WorldStateView(worldView, actionConstraintEnv, constraintArgs, {
                    general: currentGeneral,
                    city: currentCity,
                    nation: currentNation,
                });
                const constraints = definition.buildConstraints(constraintCtx, actionArgs);
                const result = evaluateConstraints(constraints, constraintCtx, view);
                if (result.kind !== 'allow') {
                    const failedDefinition = definition;
                    const failedActionArgs = actionArgs;
                    definition = fallbackDefinition;
                    actionArgs = definition.parseArgs({}) ?? {};
                    actionKey = definition.key;
                    usedFallback = true;
                    const reason = result.kind === 'deny' ? result.reason : '조건을 확인할 수 없습니다.';
                    blockedReason = reason;
                    const meta = result.kind === 'deny' ? { constraintName: result.constraintName } : undefined;
                    const failureText =
                        failedDefinition.formatConstraintFailure?.(reason, constraintCtx, failedActionArgs, view) ??
                        `${reason} ${failedDefinition.name} 실패.`;
                    logs.push(createActionLog(failureText, meta));
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
                    if (options.commandRngFactory) {
                        return options.commandRngFactory({
                            kind,
                            actionKey: key,
                            seed: rngSeed,
                        });
                    }
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
                    getAdditionalOccupiedUniqueItemKeys: options.getAdditionalOccupiedUniqueItemKeys,
                });
                let actionRng = sharedActionRng ?? buildRng(actionKey);
                let baseContext: ActionContextBase = {
                    general: currentGeneral,
                    city: currentCity,
                    nation: currentNation,
                    ...(worldView
                        ? {
                              worldView: {
                                  listGenerals: () => worldView.listGenerals(),
                                  listGeneralsByCity: (cityId: number) =>
                                      worldView.listGenerals().filter((general) => general.cityId === cityId),
                                  listNations: () => worldView.listNations(),
                              },
                          }
                        : {}),
                    rng: actionRng,
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
                    actionRng = sharedActionRng ?? buildRng(actionKey);
                    baseContext = {
                        general: currentGeneral,
                        city: currentCity,
                        nation: currentNation,
                        rng: actionRng,
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
                        return { actionKey, usedFallback, completed: false, blockedReason };
                    }
                }

                const lastTurnBeforeExecution = JSON.stringify(currentGeneral.lastTurn ?? {});
                const generalBeforeExecution = currentGeneral;
                const cityNationIdsBeforeExecution = new Map(
                    (worldView?.listCities() ?? []).map((city) => [city.id, city.nationId] as const)
                );
                const resolution = resolveGeneralAction(
                    definition,
                    actionContext,
                    {
                        now: currentGeneral.turnTime,
                        schedule: context.schedule,
                    },
                    actionArgs
                );
                for (const troopId of resolution.deletedTroopIds ?? []) {
                    commandDeletedTroopIds.add(troopId);
                }

                currentGeneral = resolution.general as TurnGeneral;
                currentCity = resolution.city ?? currentCity;
                currentNation = resolution.nation ?? currentNation;
                if (!resolution.alternative && !usedFallback && resolution.completed) {
                    currentGeneral = applyLegacyGeneralProgression(
                        currentGeneral,
                        generalBeforeExecution,
                        actionKey,
                        env,
                        logs
                    );
                }
                if (
                    !resolution.alternative &&
                    kind === 'nation' &&
                    !usedFallback &&
                    resolution.completed &&
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
                    resolution.completed &&
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
                if (!resolution.alternative && kind === 'general' && !usedFallback && resolution.completed) {
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
                if (
                    !resolution.alternative &&
                    kind === 'nation' &&
                    !usedFallback &&
                    resolution.completed &&
                    currentNation
                ) {
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
                    if (actionKey === 'che_거병') {
                        for (const nation of newNations) {
                            options.reservedTurns.ensureNationTurns(nation.id, 12);
                            options.reservedTurns.ensureNationTurns(nation.id, 11);
                        }
                    }
                    if (worldOverlay) {
                        for (const nation of newNations) {
                            worldOverlay.syncNation(nation);
                        }
                    }
                }

                const cityNationChanges = (resolution.patches?.cities ?? []).flatMap((patch) => {
                    if (!Object.prototype.hasOwnProperty.call(patch.patch ?? {}, 'nationId')) {
                        return [];
                    }
                    const nextNationId = patch.patch.nationId;
                    const previousNationId = cityNationIdsBeforeExecution.get(patch.id);
                    if (
                        typeof nextNationId !== 'number' ||
                        (previousNationId !== undefined && nextNationId === previousNationId)
                    ) {
                        return [];
                    }
                    return [{ cityId: patch.id, nextNationId }];
                });
                const hasNationChange = cityNationChanges.length > 0;
                const refreshesFrontForDiplomacyState =
                    actionKey === 'che_이호경식' &&
                    resolution.effects.some(
                        (effect) =>
                            effect.type === 'diplomacy:patch' &&
                            Object.prototype.hasOwnProperty.call(effect.patch, 'state')
                    );
                // 레거시 건국 계열과 무작위 수도 이전은 명령이 직접 지정한
                // front 값만 바꾸고 전체 전선을 즉시 재계산하지 않는다.
                const preservesImmediateFrontState = [
                    'che_건국',
                    'cr_건국',
                    'che_무작위건국',
                    'che_무작위수도이전',
                ].includes(actionKey);
                if ((hasNationChange || refreshesFrontForDiplomacyState) && !preservesImmediateFrontState) {
                    const worldView = worldOverlay?.view ?? worldRef;
                    if (worldView && options.map) {
                        const frontNationIds = new Set<number>();
                        const cityById = new Map(worldView.listCities().map((city) => [city.id, city] as const));
                        const mapCityById = new Map(options.map.cities.map((city) => [city.id, city] as const));
                        for (const change of cityNationChanges) {
                            frontNationIds.add(change.nextNationId);
                            const mapCity = mapCityById.get(change.cityId);
                            for (const cityId of [change.cityId, ...(mapCity?.connections ?? [])]) {
                                const nationId = cityById.get(cityId)?.nationId;
                                if (nationId && nationId > 0) {
                                    frontNationIds.add(nationId);
                                }
                            }
                        }
                        if (refreshesFrontForDiplomacyState) {
                            for (const effect of resolution.effects) {
                                if (effect.type !== 'diplomacy:patch') {
                                    continue;
                                }
                                frontNationIds.add(effect.srcNationId);
                                frontNationIds.add(effect.destNationId);
                            }
                        }
                        const frontPatches = buildFrontStatePatches({
                            worldView,
                            map: options.map,
                            nationIds: [...frontNationIds],
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
                        alternativeDepth + 1,
                        actionRng
                    );
                }

                return {
                    nextTurnAt: applyNextTurnAt ? resolution.nextTurnAt : undefined,
                    actionKey,
                    usedFallback,
                    completed: resolution.completed,
                    blockedReason,
                };
            };

            const lifecycleBefore = cloneTurnGeneral(currentGeneral);
            currentGeneral = cloneTurnGeneral(currentGeneral);
            if (currentGeneral.npcState < 2) {
                currentGeneral.meta.inherit_lived_month =
                    readMetaNumber(currentGeneral.meta, 'inherit_lived_month', 0) + 1;
            }
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
            currentCity = currentCity ? { ...currentCity, meta: { ...currentCity.meta } } : currentCity;
            let cityGeneralCopies: Map<number, TurnGeneral> | undefined;
            const getCityGeneralCopies = (): Map<number, TurnGeneral> => {
                if (cityGeneralCopies) {
                    return cityGeneralCopies;
                }
                cityGeneralCopies = new Map<number, TurnGeneral>();
                for (const general of worldView?.listGenerals() ?? []) {
                    if (general.cityId !== currentGeneral.cityId) {
                        continue;
                    }
                    cityGeneralCopies.set(
                        general.id,
                        general.id === currentGeneral.id ? currentGeneral : cloneTurnGeneral(general)
                    );
                }
                cityGeneralCopies.set(currentGeneral.id, currentGeneral);
                return cityGeneralCopies;
            };
            const preTurnPipeline = new GeneralActionPipeline(env.generalActionModules ?? []);
            const preTurnContext = createGeneralTriggerContext({
                general: currentGeneral,
                nation: currentNation,
                worldView: {
                    listGenerals: () => Array.from(getCityGeneralCopies().values()),
                    listGeneralsByCity: (cityId) =>
                        Array.from(getCityGeneralCopies().values()).filter((general) => general.cityId === cityId),
                },
                rng: preprocessRng,
                log: {
                    push: (message) => logs.push(createActionLog(message)),
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
                    const releasedCrew = Math.trunc(
                        preTurnPipeline.onCalcDomestic(preTurnContext, '징집인구', 'score', currentGeneral.crew)
                    );
                    if (currentCity) {
                        currentCity = {
                            ...currentCity,
                            population: currentCity.population + releasedCrew,
                            meta: { ...currentCity.meta },
                        };
                        worldOverlay?.syncCity(currentCity);
                    }
                    currentGeneral.crew = 0;
                    currentGeneral.rice = 0;
                    logs.push(createActionLog('군량이 모자라 병사들이 <R>소집해제</>되었습니다!'));
                    preTurnContext.skill.activate('pre.소집해제');
                }
                preTurnContext.skill.activate('pre.병력군량소모');
            }
            for (const [generalId, next] of cityGeneralCopies ?? []) {
                if (generalId === currentGeneral.id) {
                    continue;
                }
                const previous = worldView?.getGeneralById(generalId);
                if (!previous || previous.injury === next.injury) {
                    continue;
                }
                patches.generals.push({ id: generalId, patch: { injury: next.injury } });
                worldOverlay?.applyGeneralPatch(generalId, { injury: next.injury });
            }
            worldOverlay?.syncGeneral(currentGeneral);

            const blockCode = readMetaNumber(currentGeneral.meta, 'block', 0);
            const isBlocked = blockCode === 2 || blockCode === 3;
            if (isBlocked) {
                currentGeneral.meta.killturn = Math.max(0, currentGeneral.meta.killturn - 1);
                logs.push(
                    createActionLog(
                        blockCode === 2
                            ? '현재 멀티, 또는 비매너로 인한<R>블럭</> 대상자입니다.'
                            : '현재 악성유저로 분류되어 <R>블럭</> 대상자입니다.'
                    )
                );
            }

            let hasReservedTurn = false;
            if (!isBlocked && currentNation && currentGeneral.officerLevel >= 5) {
                let nationCommand = options.reservedTurns.getNationTurn(
                    currentNation.id,
                    currentGeneral.officerLevel,
                    0
                );
                if (nationCommand.action !== DEFAULT_ACTION) {
                    hasReservedTurn = true;
                }
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
                    completed: nationResult.completed,
                    ...(nationResult.blockedReason ? { blockedReason: nationResult.blockedReason } : {}),
                    ...(nationAiState ? { aiState: nationAiState } : {}),
                });
                options.reservedTurns.shiftNationTurns(currentNation.id, currentGeneral.officerLevel, -1);
            }
            if (isBlocked && currentNation && currentGeneral.officerLevel >= 5) {
                options.reservedTurns.shiftNationTurns(currentNation.id, currentGeneral.officerLevel, -1);
            }

            let generalCommand = options.reservedTurns.getGeneralTurn(currentGeneral.id, 0);
            if (!isBlocked && generalCommand.action !== DEFAULT_ACTION) {
                hasReservedTurn = true;
            }
            let generalAiState: ReturnType<GeneralAI['getDebugState']> | undefined;
            let generalAutorunMode = false;
            if (!isBlocked && worldView && shouldUseAi(currentGeneral, context.world)) {
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
                      completed: false,
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
                completed: generalResult.completed,
                ...(generalResult.blockedReason ? { blockedReason: generalResult.blockedReason } : {}),
                ...(generalAiState ? { aiState: generalAiState } : {}),
            });
            let nextTurnAt = 'nextTurnAt' in generalResult ? generalResult.nextTurnAt : undefined;
            options.reservedTurns.shiftGeneralTurns(currentGeneral.id, -1);

            const worldMeta = asRecord(context.world.meta);
            if (!isBlocked) {
                const meta = { ...currentGeneral.meta };
                const currentKillturn = readMetaNumber(meta, 'killturn', 0);
                const worldKillturn = readMetaNumber(worldMeta, 'killturn', currentKillturn);
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

            const incDefSettingChange = readConfigNumber(options.scenarioConfig, 'incDefSettingChange', 3);
            const maxDefSettingChange = readConfigNumber(options.scenarioConfig, 'maxDefSettingChange', 9);
            currentGeneral = {
                ...currentGeneral,
                meta: {
                    ...currentGeneral.meta,
                    myset: Math.min(
                        maxDefSettingChange,
                        readMetaNumber(currentGeneral.meta, 'myset', 0) + incDefSettingChange
                    ),
                },
            };

            const autorunUser = asRecord(worldMeta.autorun_user);
            const autorunLimitMinutes = readMetaNumber(autorunUser, 'limit_minutes', 0);
            if (hasReservedTurn && currentGeneral.npcState < 2 && autorunLimitMinutes > 0) {
                const turnMinutes = Math.max(1, Math.round(context.world.tickSeconds / 60));
                currentGeneral.meta.autorun_limit =
                    joinYearMonth(context.world.currentYear, context.world.currentMonth) +
                    Math.trunc(autorunLimitMinutes / turnMinutes);
            }

            const nextTurnTimeBase = readMetaNumber(currentGeneral.meta, 'nextTurnTimeBase', -1);
            if (nextTurnTimeBase >= 0) {
                const alignedNextTurn = nextTurnAt ?? getNextTurnAt(currentGeneral.turnTime, context.schedule);
                nextTurnAt = new Date(alignedNextTurn.getTime() + nextTurnTimeBase * 1000);
                delete currentGeneral.meta.nextTurnTimeBase;
            }

            let lifecycleOutcome: 'active' | 'detached' | 'deleted' | 'retired' = 'active';
            let deleteGeneral = false;
            const deletedTroopIds = Array.from(commandDeletedTroopIds);
            const lifecycleSnapshot = cloneTurnGeneral(currentGeneral);
            if (currentGeneral.meta.killturn <= 0 && typeof currentGeneral.deadYear === 'number') {
                if (
                    currentGeneral.npcState === 1 &&
                    typeof currentGeneral.deadYear === 'number' &&
                    currentGeneral.deadYear > context.world.currentYear
                ) {
                    const npcOrg = readMetaNumber(currentGeneral.meta, 'npc_org', 2);
                    const ownerName =
                        typeof currentGeneral.meta.owner_name === 'string'
                            ? currentGeneral.meta.owner_name
                            : currentGeneral.userId;
                    logs.push(
                        createActionLog(
                            `${ownerName ?? '사용자'}이 <Y>${currentGeneral.name}</>의 육체에서 <S>유체이탈</>합니다!`
                        )
                    );
                    currentGeneral = {
                        ...currentGeneral,
                        userId: null,
                        npcState: npcOrg,
                        meta: {
                            ...currentGeneral.meta,
                            killturn: (currentGeneral.deadYear - context.world.currentYear) * 12,
                            defence_train: 80,
                            owner_name: '',
                        },
                    };
                    lifecycleOutcome = 'detached';
                } else {
                    if (currentGeneral.officerLevel === 12 && currentNation && worldView) {
                        const candidates = worldView
                            .listGenerals()
                            .filter(
                                (candidate) =>
                                    candidate.id !== currentGeneral.id &&
                                    candidate.nationId === currentGeneral.nationId &&
                                    candidate.officerLevel !== 12 &&
                                    candidate.npcState !== 5
                            );
                        let successor: TurnGeneral | undefined;
                        const fiction = readMetaNumber(worldMeta, 'fiction', 0);
                        if (
                            fiction === 0 &&
                            currentGeneral.npcState > 0 &&
                            typeof currentGeneral.affinity === 'number'
                        ) {
                            const npcCandidates = candidates.filter(
                                (candidate) =>
                                    candidate.npcState >= 1 &&
                                    candidate.npcState <= 3 &&
                                    typeof candidate.affinity === 'number'
                            );
                            const affinityDistance = (candidate: TurnGeneral): number => {
                                const distance = Math.abs((candidate.affinity ?? 0) - (currentGeneral.affinity ?? 0));
                                return distance > 75 ? 150 - distance : distance;
                            };
                            const minDistance = Math.min(...npcCandidates.map(affinityDistance));
                            const nearest = npcCandidates.filter(
                                (candidate) => affinityDistance(candidate) === minDistance
                            );
                            if (nearest.length > 0) {
                                const rng = new RandUtil(
                                    new LiteHashDRBG(
                                        serializeSeed(
                                            buildSeedBase(context.world),
                                            'NextNPCRuler',
                                            context.world.currentYear,
                                            context.world.currentMonth,
                                            currentGeneral.id
                                        )
                                    )
                                );
                                successor = rng.choice(nearest);
                            }
                        }
                        successor ??= candidates
                            .filter((candidate) => candidate.officerLevel >= 9)
                            .sort((left, right) => right.officerLevel - left.officerLevel || left.id - right.id)[0];
                        successor ??= candidates.sort(
                            (left, right) => right.dedication - left.dedication || left.id - right.id
                        )[0];
                        if (successor) {
                            patches.generals.push({
                                id: successor.id,
                                patch: { officerLevel: 12 },
                            });
                            currentNation = {
                                ...currentNation,
                                chiefGeneralId: successor.id,
                            };
                            logs.push(
                                createActionLog(
                                    `<Y>${successor.name}</>이 <D><b>${currentNation.name}</b></>의 유지를 이어 받았습니다`
                                )
                            );
                        }
                    }
                    if (currentGeneral.troopId === currentGeneral.id) {
                        deletedTroopIds.push(currentGeneral.id);
                        for (const member of worldView?.listGenerals() ?? []) {
                            if (member.id !== currentGeneral.id && member.troopId === currentGeneral.id) {
                                patches.generals.push({ id: member.id, patch: { troopId: 0 } });
                            }
                        }
                    }
                    if (currentNation) {
                        const gennum = readMetaNumber(asRecord(currentNation.meta), 'gennum', 0);
                        currentNation = {
                            ...currentNation,
                            meta: {
                                ...currentNation.meta,
                                gennum: Math.max(0, gennum - 1),
                            },
                        };
                    }
                    deleteGeneral = true;
                    lifecycleOutcome = 'deleted';
                }
            }

            const retirementYear = readConfigNumber(options.scenarioConfig, 'retirementYear', 80);
            if (!deleteGeneral && currentGeneral.age >= retirementYear && currentGeneral.npcState === 0) {
                currentGeneral = resetRetiredGeneral(currentGeneral);
                lifecycleOutcome = 'retired';
                logs.push(createActionLog('나이가 들어 <R>은퇴</>하고 자손에게 자리를 물려줍니다.'));
            }

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
                ...(deleteGeneral || deletedTroopIds.length > 0
                    ? {
                          deleted: {
                              general: deleteGeneral,
                              ...(deletedTroopIds.length > 0 ? { troopIds: deletedTroopIds } : {}),
                          },
                      }
                    : undefined),
                lifecycleEvent: {
                    generalId: currentGeneral.id,
                    outcome: lifecycleOutcome,
                    before: lifecycleOutcome === 'active' ? lifecycleBefore : lifecycleSnapshot,
                    ...(deleteGeneral ? {} : { after: currentGeneral }),
                    year: context.world.currentYear,
                    month: context.world.currentMonth,
                },
            };

            return result;
        },
    };
};
