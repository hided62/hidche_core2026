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
    GeneralTurnCommandKey,
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
    readScenarioGeneralPoolClaim,
    rollUniqueLotteryDetailed,
    getNextTurnAt,
    getBillByLevel,
    LEGACY_DEFAULT_MAX_LEVEL,
    orderLegacyActionLoggerFlush,
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
import { GeneralAI, shouldUseAi, shouldUseNationAi } from './ai/generalAi.js';
import type { AiReservedTurnProvider } from './ai/types.js';
import { withCanonicalArgumentAliases } from './ai/aiUtils.js';
import { rankMetaKey } from './rankData.js';
import {
    hasScenarioStaticEventHandler,
    IMMEDIATE_ASSIGNMENT_GATHER_HANDLER,
    LEGACY_NATION_ASSIGNMENT_EVENT,
} from './scenarioStaticEvents.js';

const DEFAULT_ACTION = '휴식';
const AI_INTERNAL_GENERAL_ACTION_KEYS = ['che_NPC능동'] as const satisfies readonly GeneralTurnCommandKey[];

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
    'che_선동',
    'che_파괴',
    'che_탈취',
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
    // These legacy classes inherit che_상업투자::run(), including its
    // unconditional checkStatChange() tail.
    'che_농지개간',
    'che_수비강화',
    'che_성벽보수',
    'che_치안강화',
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

// 아래 Ref 커맨드는 성공 로그보다 addExperience/addDedication을 먼저 호출한다.
// 이 차이는 같은 ActionLogger의 GENERAL/ACTION 버퍼 안에서 보이며, 등용수락은
// 메시지 즉시 실행과 예약 턴 차등 fixture 모두 같은 순서를 사용한다.
const LEGACY_PROGRESSION_BEFORE_ACTION_LOGS = new Set([
    'che_등용수락',
    'che_감축',
    'che_국기변경',
    'che_국호변경',
    'che_무작위수도이전',
    'che_증축',
    'che_천도',
    'che_초토화',
    'cr_인구이동',
    'event_극병연구',
    'event_대검병연구',
    'event_무희연구',
    'event_산저병연구',
    'event_상병연구',
    'event_원융노병연구',
    'event_음귀병연구',
    'event_화륜차연구',
    'event_화시병연구',
]);

const orderLegacyCommandLogs = (
    actionKey: string,
    actionLogs: readonly LogEntryDraft[],
    progressionLogs: readonly LogEntryDraft[],
    postProgressionLogs: readonly LogEntryDraft[]
): LogEntryDraft[] =>
    orderLegacyActionLoggerFlush(
        LEGACY_PROGRESSION_BEFORE_ACTION_LOGS.has(actionKey)
            ? [...progressionLogs, ...actionLogs, ...postProgressionLogs]
            : [...actionLogs, ...progressionLogs, ...postProgressionLogs]
    );

export const applyLegacyGeneralProgression = (
    general: TurnGeneral,
    previousGeneral: TurnGeneral,
    actionKey: string,
    env: TurnCommandEnv,
    logs: LogEntryDraft[]
): TurnGeneral => {
    const maxStatLevel = env.maxStatLevel ?? LEGACY_DEFAULT_MAX_LEVEL;
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
    // Battle units update levels before finishBattle() rounds the legacy INT
    // columns. che_출병 must retain that pre-round result just like Ref.
    const preserveLevel =
        actionKey === 'che_은퇴' ||
        actionKey === 'che_선양' ||
        actionKey === 'che_출병' ||
        actionKey === 'che_물자조달';
    const preservesResolvedProcurementLevel = actionKey === 'che_물자조달';
    if (
        preservesResolvedProcurementLevel ||
        (!preserveLevel && (forceRefreshLevel || general.experience !== previousGeneral.experience))
    ) {
        const previousExpLevel = readMetaNumber(previousGeneral.meta, 'explevel', 0);
        const actionResolvedExpLevel = readMetaNumber(general.meta, 'explevel', previousExpLevel);
        const nextExpLevel = preservesResolvedProcurementLevel ? actionResolvedExpLevel : expLevel;
        meta.explevel = nextExpLevel;
        if (
            nextExpLevel !== previousExpLevel &&
            (preservesResolvedProcurementLevel || actionResolvedExpLevel !== nextExpLevel)
        ) {
            const josaRo = JosaUtil.pick(String(nextExpLevel), '로');
            logs.push(
                createGeneralActionLog(
                    general.id,
                    nextExpLevel > previousExpLevel
                        ? `<C>Lv ${nextExpLevel}</>${josaRo} <C>레벨업</>!`
                        : `<C>Lv ${nextExpLevel}</>${josaRo} <R>레벨다운</>!`,
                    { format: LogFormat.PLAIN }
                )
            );
        }
    }
    if (
        preservesResolvedProcurementLevel ||
        (!preserveLevel && (forceRefreshLevel || general.dedication !== previousGeneral.dedication))
    ) {
        const previousDedicationLevel = readMetaNumber(previousGeneral.meta, 'dedlevel', 0);
        const actionResolvedDedicationLevel = readMetaNumber(general.meta, 'dedlevel', previousDedicationLevel);
        const nextDedicationLevel = preservesResolvedProcurementLevel ? actionResolvedDedicationLevel : dedicationLevel;
        meta.dedlevel = nextDedicationLevel;
        if (nextDedicationLevel !== previousDedicationLevel) {
            const dedicationLevelText =
                nextDedicationLevel === 0 ? '무품관' : `${maxDedicationLevel - nextDedicationLevel + 1}품관`;
            const billText = getBillByLevel(nextDedicationLevel).toLocaleString('en-US');
            const josaRoDedication = JosaUtil.pick(dedicationLevelText, '로');
            const josaRoBill = JosaUtil.pick(billText, '로');
            logs.push(
                createGeneralActionLog(
                    general.id,
                    nextDedicationLevel > previousDedicationLevel
                        ? `<Y>${dedicationLevelText}</>${josaRoDedication} <C>승급</>하여 봉록이 <C>${billText}</>${josaRoBill} <C>상승</>했습니다!`
                        : `<Y>${dedicationLevelText}</>${josaRoDedication} <R>강등</>되어 봉록이 <C>${billText}</>${josaRoBill} <R>하락</>했습니다!`,
                    { format: LogFormat.PLAIN }
                )
            );
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
    ...(general.inheritancePoints ? { inheritancePoints: { ...general.inheritancePoints } } : {}),
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

const readInheritanceNumber = (value: unknown): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
};

const canAccumulateInheritance = (
    general: Pick<TurnGeneral, 'userId' | 'npcState'>,
    worldMeta: Record<string, unknown>
): general is Pick<TurnGeneral, 'userId' | 'npcState'> & { userId: string } =>
    Boolean(general.userId) &&
    general.npcState < 2 &&
    readMetaNumber(worldMeta, 'isunited', readMetaNumber(worldMeta, 'isUnited', 0)) === 0;

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
    inheritItemRandomPoint: number;
    inheritanceWorld?: InMemoryTurnWorld | null;
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
        const outcome = rollUniqueLotteryDetailed({
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
        if (outcome.status === 'NO_SLOT' || outcome.status === 'NO_SUPPLY') {
            if (inheritRandomUnique) {
                const turnGeneral = general as TurnGeneral;
                const cost = options.inheritItemRandomPoint;
                const nextMeta = {
                    ...turnGeneral.meta,
                    // Explicit retirement resets every rank before this lottery in Ref,
                    // so a failed pending purchase leaves the post-rebirth delta at -cost.
                    inherit_spent_dyn:
                        reason === '은퇴'
                            ? -cost
                            : readMetaNumber(asRecord(turnGeneral.meta), 'inherit_spent_dyn', 0) - cost,
                } as TurnGeneral['meta'];
                delete nextMeta.inheritRandomUnique;
                turnGeneral.meta = nextMeta;
                turnGeneral.inheritancePoints = {
                    ...turnGeneral.inheritancePoints,
                    previous: readInheritanceNumber(turnGeneral.inheritancePoints?.previous) + cost,
                };
                if (turnGeneral.userId) {
                    const persistencePhase = reason === '은퇴' ? 'after_lifecycle' : undefined;
                    options.inheritanceWorld?.queueInheritancePointAdjustment(
                        turnGeneral.userId,
                        'previous',
                        cost,
                        persistencePhase
                    );
                    options.inheritanceWorld?.queueInheritanceLog({
                        userId: turnGeneral.userId,
                        year: world.currentYear,
                        month: world.currentMonth,
                        text:
                            outcome.status === 'NO_SLOT'
                                ? `유니크를 얻을 공간이 없어 ${cost} 포인트 반환`
                                : `얻을 유니크가 없어 ${cost} 포인트 반환`,
                        ...(persistencePhase ? { phase: persistencePhase } : {}),
                    });
                }
            }
            return null;
        }
        if (outcome.status === 'ROLL_FAILED') {
            return null;
        }
        if (inheritRandomUnique && availableBuyUnique) {
            delete asRecord(general.meta).inheritRandomUnique;
        }
        return options.itemRegistry.get(outcome.itemKey) ?? null;
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
    listGeneralPoolCandidates(claimedAt: Date): ReturnType<InMemoryTurnWorld['listGeneralPoolCandidates']>;
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
        listGeneralPoolCandidates: (claimedAt) => {
            const candidates = world.listGeneralPoolCandidates(claimedAt);
            if (!candidates) {
                return candidates;
            }
            const overlayClaimedIds = new Set<number>();
            for (const general of generalOverrides.values()) {
                const claim = readScenarioGeneralPoolClaim(general.meta);
                if (claim) {
                    overlayClaimedIds.add(claim.poolEntryId);
                }
            }
            return candidates.filter((candidate) => !overlayClaimedIds.has(candidate.poolEntryId));
        },
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

/**
 * Ref ActionLogger is constructed with a general ID, so every personal action
 * log carries its owner before it reaches persistence. Keep that ownership
 * explicit here: finalizeLogEntry intentionally rejects ownerless GENERAL logs.
 */
interface GeneralActionLogOptions {
    format?: LogFormat;
    meta?: Record<string, unknown>;
}

const createGeneralActionLog = (
    generalId: number,
    message: string,
    options: GeneralActionLogOptions = {}
): LogEntryDraft => ({
    scope: LogScope.GENERAL,
    category: LogCategory.ACTION,
    generalId,
    format: options.format ?? LogFormat.MONTH,
    text: message,
    ...(options.meta ? { meta: options.meta } : {}),
});

const resolveDefinition = (
    actionKey: string,
    definitions: Map<string, GeneralActionDefinition>,
    kind: 'general' | 'nation'
): GeneralActionDefinition => {
    const definition = definitions.get(actionKey);
    if (!definition) {
        throw new Error(`Unknown reserved ${kind} turn command: ${actionKey}`);
    }
    return definition;
};

export const createReservedTurnHandler = async (options: {
    reservedTurns: InMemoryReservedTurnStore;
    scenarioConfig: ScenarioConfig;
    scenarioMeta?: ScenarioMeta;
    map?: MapDefinition;
    unitSet?: UnitSetDefinition;
    getWorld: () => InMemoryTurnWorld | null;
    commandProfile?: TurnCommandProfile;
    commandEnv?: TurnCommandEnv;
    now?: () => Date;
    messageSharedIconBaseUrl?: string;
    commandRngFactory?: (input: { kind: 'nation' | 'general'; actionKey: string; seed: string }) => RandUtil;
    getAdditionalOccupiedUniqueItemKeys?: () => Iterable<string | null | undefined>;
    calculateNpcNationFinance?: (
        world: InMemoryTurnWorld,
        nation: Nation,
        currentMonth: number
    ) => Nation['meta'] | null;
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
    onActionProfiled?: (payload: {
        kind: 'nation' | 'general';
        generalId: number;
        nationId: number | null;
        officerLevel: number;
        npcState: number;
        year: number;
        month: number;
        requestedAction: string;
        actionKey: string;
        usedFallback: boolean;
        usedAi: boolean;
        aiDecisionDurationNs: bigint;
        actionDurationNs: bigint;
    }) => void;
}): Promise<GeneralTurnHandler> => {
    const env = options.commandEnv ?? buildCommandEnv(options.scenarioConfig, options.unitSet);
    const itemRegistry = createItemModuleRegistry(await loadItemModules([...ITEM_KEYS]));
    const uniqueConfig = resolveUniqueConfig(asRecord(options.scenarioConfig.const));
    const inheritItemRandomPoint = readMetaNumber(
        asRecord(options.scenarioConfig.const),
        'inheritItemRandomPoint',
        3_000
    );
    if (Object.keys(uniqueConfig.allItems).length === 0) {
        uniqueConfig.allItems = buildLegacyDefaultUniqueItemPool(itemRegistry);
    }
    const commandProfile = options.commandProfile ?? DEFAULT_TURN_COMMAND_PROFILE;
    const { general: generalDefinitions, nation: nationDefinitions } = await buildReservedTurnDefinitions({
        env,
        commandProfile,
        defaultActionKey: DEFAULT_ACTION,
    });
    if (process.env.CORE_AI_TRACE_GENERAL_IDS) {
        process.stdout.write(
            `RESERVED_TURN_DEFINITION_TRACE ${JSON.stringify({
                profileHasAppointment: commandProfile.general.includes('che_임관'),
                definitionHasAppointment: generalDefinitions.has('che_임관'),
                generalDefinitionCount: generalDefinitions.size,
            })}\n`
        );
    }
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
    // NPC AI emits a few engine-internal commands that are intentionally not
    // exposed by the scenario's player command profile. Keep their definitions
    // available to AI resolution without adding them to the public profile.
    for (const key of AI_INTERNAL_GENERAL_ACTION_KEYS) {
        const module = await generalModuleLoader.load(key);
        if (!generalDefinitions.has(key)) {
            generalDefinitions.set(key, module.commandSpec.createDefinition(env));
        }
        seenActionKeys.add(key);
        applyActionContextBuilder(module);
    }
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
            // Legacy reads the current game_env.develcost for every command.
            // Scenario const is only a fallback; the value changes with year.
            env.develCost = readMetaNumber(asRecord(context.world.meta), 'develcost', env.develCost);
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
            const destroyedNationIds = new Set<number>();

            let currentGeneral = context.general;
            let currentCity = context.city;
            let currentNation = context.nation ?? null;
            // Ref는 장수와 첫 커맨드를 만들 때 getNationStaticInfo 캐시를 채운다.
            // 같은 장수 lifecycle의 국호변경은 뒤이은 유니크 획득 로그의 국호를 바꾸지 않는다.
            const legacyStaticNationName = currentNation?.name ?? '재야';

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
                const resolvedDefinition = resolveDefinition(command.action, definitionMap, kind);
                const rawArgs = extractArgsRecord(command.args);
                const parsedArgs = resolvedDefinition.parseArgs(rawArgs);
                let definition = resolvedDefinition;
                let actionArgs = parsedArgs ?? {};
                let actionKey = definition.key;
                let usedFallback = false;
                let blockedReason: string | undefined = undefined;

                if (parsedArgs === null) {
                    const failureText = `인자가 올바르지 않습니다. ${resolvedDefinition.name} 실패.`;
                    definition = fallbackDefinition;
                    actionArgs = definition.parseArgs({}) ?? {};
                    actionKey = definition.key;
                    usedFallback = true;
                    blockedReason = failureText;
                    logs.push(createGeneralActionLog(currentGeneral.id, failureText));
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
                    logs.push(createGeneralActionLog(currentGeneral.id, failureText, meta ? { meta } : {}));
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
                        logs.push(createGeneralActionLog(currentGeneral.id, blockedReason));
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
                    inheritItemRandomPoint,
                    inheritanceWorld: worldRef,
                    getAdditionalOccupiedUniqueItemKeys: options.getAdditionalOccupiedUniqueItemKeys,
                });
                let actionRng = sharedActionRng ?? buildRng(actionKey);
                const actionTime = {
                    year: context.world.currentYear,
                    month: context.world.currentMonth,
                    startYear: resolveStartYear(context.world, options.scenarioMeta),
                };
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
                    time: actionTime,
                    maxTechLevel: env.maxTechLevel,
                    uniqueLottery,
                    legacyStaticNationName,
                };
                let specificContext = buildActionContext(
                    actionKey,
                    baseContext,
                    {
                        world: context.world,
                        gameNow: options.now?.() ?? currentGeneral.turnTime,
                        messageSharedIconBaseUrl: options.messageSharedIconBaseUrl,
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
                    logs.push(createGeneralActionLog(currentGeneral.id, '예약된 명령을 실행하지 못했습니다.'));
                    actionRng = sharedActionRng ?? buildRng(actionKey);
                    baseContext = {
                        general: currentGeneral,
                        city: currentCity,
                        nation: currentNation,
                        rng: actionRng,
                        time: actionTime,
                        maxTechLevel: env.maxTechLevel,
                    };
                    specificContext = baseContext;
                }
                const actionContext = specificContext ?? baseContext;
                if ((process.env.CORE_AI_TRACE_GENERAL_IDS?.split(',') ?? []).includes(String(currentGeneral.id))) {
                    const tracedContext = actionContext as ActionContextBase & {
                        destCity?: City;
                        destGeneral?: TurnGeneral;
                    };
                    process.stdout.write(
                        `AI_ACTION_INPUT_TRACE ${JSON.stringify({ generalId: currentGeneral.id, kind, actionKey, actionArgs, destCityId: tracedContext.destCity?.id, destGeneralId: tracedContext.destGeneral?.id })}\n`
                    );
                }
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
                        logs.push(createGeneralActionLog(currentGeneral.id, progressText));
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
                if (
                    (process.env.CORE_AI_TRACE_GENERAL_IDS?.split(',') ?? []).includes(String(currentGeneral.id)) &&
                    resolution.patches
                ) {
                    process.stdout.write(
                        `AI_ACTION_PATCH_TRACE ${JSON.stringify({ generalId: currentGeneral.id, kind, actionKey, patches: resolution.patches })}\n`
                    );
                }
                for (const troopId of resolution.deletedTroopIds ?? []) {
                    commandDeletedTroopIds.add(troopId);
                }
                for (const plan of resolution.reservedGeneralTurnPlans ?? []) {
                    for (let turnIdx = 0; turnIdx < plan.joinTurn; turnIdx += 1) {
                        options.reservedTurns.setGeneralTurn(plan.generalId, turnIdx, {
                            action: 'che_견문',
                            args: {},
                        });
                    }
                    options.reservedTurns.setGeneralTurn(plan.generalId, plan.joinTurn, {
                        action: 'che_임관',
                        args: { destNationId: plan.destNationId },
                    });
                }

                currentGeneral = resolution.general as TurnGeneral;
                currentCity = resolution.city ?? currentCity;
                currentNation = resolution.nation ?? currentNation;
                const inheritanceEnabled = canAccumulateInheritance(currentGeneral, asRecord(context.world.meta));
                const inheritanceUserId = inheritanceEnabled ? currentGeneral.userId : null;
                if (actionKey === 'che_인재탐색') {
                    const previousActive = readMetaNumber(
                        asRecord(generalBeforeExecution.meta),
                        'inherit_active_action',
                        0
                    );
                    const nextActive = readMetaNumber(asRecord(currentGeneral.meta), 'inherit_active_action', 0);
                    if (!inheritanceUserId) {
                        currentGeneral = {
                            ...currentGeneral,
                            meta: { ...currentGeneral.meta, inherit_active_action: previousActive },
                        };
                    } else if (nextActive > previousActive) {
                        const pointAmount = (nextActive - previousActive) * 3;
                        worldRef?.queueInheritancePointAdjustment(inheritanceUserId, 'active_action', pointAmount);
                        currentGeneral = {
                            ...currentGeneral,
                            inheritancePoints: {
                                ...currentGeneral.inheritancePoints,
                                active_action:
                                    readInheritanceNumber(currentGeneral.inheritancePoints?.active_action) +
                                    pointAmount,
                            },
                        };
                    }
                }
                const progressionLogs: LogEntryDraft[] = [];
                if (!resolution.alternative && !usedFallback && resolution.completed) {
                    currentGeneral = applyLegacyGeneralProgression(
                        currentGeneral,
                        generalBeforeExecution,
                        actionKey,
                        env,
                        progressionLogs
                    );
                }
                logs.push(
                    ...orderLegacyCommandLogs(
                        actionKey,
                        resolution.logs,
                        progressionLogs,
                        resolution.postProgressionLogs
                    )
                );
                if (
                    !resolution.alternative &&
                    kind === 'nation' &&
                    !usedFallback &&
                    resolution.completed &&
                    definition.countsAsInheritanceActiveAction &&
                    inheritanceUserId
                ) {
                    const meta = { ...currentGeneral.meta };
                    const active = typeof meta.inherit_active_action === 'number' ? meta.inherit_active_action : 0;
                    meta.inherit_active_action = active + 1;
                    worldRef?.queueInheritancePointAdjustment(inheritanceUserId, 'active_action', 3);
                    currentGeneral = {
                        ...currentGeneral,
                        meta,
                        inheritancePoints: {
                            ...currentGeneral.inheritancePoints,
                            active_action: readInheritanceNumber(currentGeneral.inheritancePoints?.active_action) + 3,
                        },
                    };
                }
                if (
                    !resolution.alternative &&
                    kind === 'general' &&
                    !usedFallback &&
                    resolution.completed &&
                    executionDefinition.getInheritanceActiveActionAmount &&
                    inheritanceEnabled
                ) {
                    const amount = executionDefinition.getInheritanceActiveActionAmount(actionContext, actionArgs);
                    if (Number.isFinite(amount) && amount !== 0) {
                        const meta = { ...currentGeneral.meta };
                        const active = typeof meta.inherit_active_action === 'number' ? meta.inherit_active_action : 0;
                        meta.inherit_active_action = active + amount;
                        const pointAmount = amount * 3;
                        worldRef?.queueInheritancePointAdjustment(inheritanceUserId!, 'active_action', pointAmount);
                        currentGeneral = {
                            ...currentGeneral,
                            meta,
                            inheritancePoints: {
                                ...currentGeneral.inheritancePoints,
                                active_action:
                                    readInheritanceNumber(currentGeneral.inheritancePoints?.active_action) +
                                    pointAmount,
                            },
                        };
                    }
                }
                if (
                    !resolution.alternative &&
                    kind === 'general' &&
                    !usedFallback &&
                    resolution.completed &&
                    inheritanceUserId
                ) {
                    const inheritancePoints = { ...currentGeneral.inheritancePoints };
                    const storedDomesticMaximum = readInheritanceNumber(inheritancePoints.max_domestic_critical);
                    const currentDomesticStreak = readInheritanceNumber(
                        asRecord(currentGeneral.meta).max_domestic_critical
                    );
                    if (currentDomesticStreak > storedDomesticMaximum) {
                        worldRef?.queueInheritancePointAdjustment(
                            inheritanceUserId,
                            'max_domestic_critical',
                            currentDomesticStreak - storedDomesticMaximum
                        );
                        inheritancePoints.max_domestic_critical = currentDomesticStreak;
                    }
                    if (actionKey === 'che_건국') {
                        worldRef?.queueInheritancePointAdjustment(inheritanceUserId, 'unifier', 250);
                        inheritancePoints.unifier = readInheritanceNumber(inheritancePoints.unifier) + 250;
                    }
                    currentGeneral = { ...currentGeneral, inheritancePoints };
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

                for (const nationId of resolution.destroyedNationIds ?? []) {
                    destroyedNationIds.add(nationId);
                }
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

                if (
                    kind === 'nation' &&
                    actionKey === 'che_발령' &&
                    !usedFallback &&
                    resolution.completed &&
                    worldOverlay &&
                    hasScenarioStaticEventHandler(
                        options.scenarioConfig,
                        LEGACY_NATION_ASSIGNMENT_EVENT,
                        IMMEDIATE_ASSIGNMENT_GATHER_HANDLER
                    )
                ) {
                    const destGeneralId = actionArgsRecord.destGeneralId;
                    const destCityId = actionArgsRecord.destCityId;
                    if (typeof destGeneralId === 'number' && typeof destCityId === 'number') {
                        const destGeneral = worldOverlay.view.getGeneralById(destGeneralId);
                        const destCity = worldOverlay.view.getCityById(destCityId);
                        if (
                            destGeneral &&
                            destCity &&
                            destGeneral.id === destGeneral.troopId &&
                            destGeneral.nationId === currentGeneral.nationId
                        ) {
                            const troopName = worldOverlay.view.getTroopById(destGeneral.id)?.name ?? '';
                            const cityJosa = JosaUtil.pick(destCity.name, '로');
                            const troopMembers = worldOverlay.view
                                .listGenerals()
                                .filter(
                                    (member) =>
                                        member.id !== destGeneral.id &&
                                        member.nationId === destGeneral.nationId &&
                                        member.troopId === destGeneral.id &&
                                        member.cityId !== destCity.id
                                );
                            for (const member of troopMembers) {
                                const patch = { cityId: destCity.id };
                                patches.generals.push({ id: member.id, patch });
                                worldOverlay.applyGeneralPatch(member.id, patch);
                                if (member.id === currentGeneral.id) {
                                    currentGeneral = applyGeneralPatch(currentGeneral, patch);
                                }
                                logs.push({
                                    scope: LogScope.GENERAL,
                                    category: LogCategory.ACTION,
                                    generalId: member.id,
                                    format: LogFormat.PLAIN,
                                    text: `${troopName} 부대원들은 <G><b>${destCity.name}</b></>${cityJosa} 즉시 집합되었습니다.`,
                                });
                            }
                        }
                    }
                }

                if (resolution.created?.generals) {
                    const newGenerals = resolution.created.generals as TurnGeneral[];
                    createdGenerals.push(...newGenerals);
                    for (const general of newGenerals) {
                        worldOverlay?.syncGeneral(general);
                        options.reservedTurns.ensureGeneralTurns(general.id);
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
            if (canAccumulateInheritance(currentGeneral, asRecord(context.world.meta))) {
                currentGeneral.meta.inherit_lived_month =
                    readMetaNumber(currentGeneral.meta, 'inherit_lived_month', 0) + 1;
                worldRef?.queueInheritancePointAdjustment(currentGeneral.userId, 'lived_month', 1);
                currentGeneral.inheritancePoints = {
                    ...currentGeneral.inheritancePoints,
                    lived_month: readInheritanceNumber(currentGeneral.inheritancePoints?.lived_month) + 1,
                };
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
                    push: (message, logOptions) =>
                        logs.push(createGeneralActionLog(currentGeneral.id, message, logOptions)),
                    pushForGeneral: (generalId, message, logOptions) =>
                        logs.push(createGeneralActionLog(generalId, message, logOptions)),
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
                    logs.push(
                        createGeneralActionLog(currentGeneral.id, '군량이 모자라 병사들이 <R>소집해제</>되었습니다!')
                    );
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
                    createGeneralActionLog(
                        currentGeneral.id,
                        blockCode === 2
                            ? '현재 멀티, 또는 비매너로 인한<R>블럭</> 대상자입니다.'
                            : '현재 악성유저로 분류되어 <R>블럭</> 대상자입니다.'
                    )
                );
            }

            let hasReservedTurn = false;
            let sharedAi: GeneralAI | undefined;
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
                let nationAiDecisionDurationNs = 0n;
                let nationUsedAi = false;
                if (worldView && shouldUseNationAi(currentGeneral, context.world)) {
                    nationUsedAi = true;
                    const aiStartedAt = options.onActionProfiled ? process.hrtime.bigint() : 0n;
                    sharedAi = new GeneralAI({
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
                    const ai = sharedAi;
                    const candidate = ai.chooseNationTurn(nationCommand);
                    if (options.onActionProfiled) {
                        nationAiDecisionDurationNs = process.hrtime.bigint() - aiStartedAt;
                    }
                    if (candidate) {
                        if (
                            (process.env.CORE_AI_TRACE_GENERAL_IDS?.split(',') ?? []).includes(
                                String(currentGeneral.id)
                            )
                        ) {
                            process.stdout.write(
                                `AI_NATION_CANDIDATE_TRACE ${JSON.stringify({ generalId: currentGeneral.id, candidate })}\n`
                            );
                        }
                        nationCommand = { action: candidate.action, args: candidate.args };
                    }
                    const promotion = ai.consumePromotionPatches();
                    for (const entry of promotion.generals) {
                        const promotedGeneral = worldOverlay?.view.getGeneralById(entry.generalId);
                        const patch = {
                            officerLevel: entry.officerLevel,
                            ...(promotedGeneral
                                ? {
                                      meta: {
                                          ...promotedGeneral.meta,
                                          officer_city: entry.officerCity,
                                          ...(entry.permission ? { permission: entry.permission } : {}),
                                      },
                                  }
                                : {}),
                        };
                        patches.generals.push({ id: entry.generalId, patch });
                        worldOverlay?.applyGeneralPatch(entry.generalId, patch);
                        if (entry.generalId === currentGeneral.id) {
                            currentGeneral = applyGeneralPatch(currentGeneral, patch);
                        }
                    }
                    if (promotion.nationMeta && currentNation) {
                        currentNation = { ...currentNation, meta: promotion.nationMeta as Nation['meta'] };
                        worldOverlay?.applyNationPatch(currentNation.id, { meta: currentNation.meta });
                    }
                    if (currentNation && currentGeneral.officerLevel === 12 && options.calculateNpcNationFinance) {
                        const baseWorld = options.getWorld();
                        const financeMeta = baseWorld
                            ? options.calculateNpcNationFinance(baseWorld, currentNation, context.world.currentMonth)
                            : null;
                        if (financeMeta) {
                            currentNation = { ...currentNation, meta: financeMeta as Nation['meta'] };
                            worldOverlay?.applyNationPatch(currentNation.id, { meta: currentNation.meta });
                        }
                    }
                    nationAiState = ai.getDebugState();
                }
                const nationActionStartedAt = options.onActionProfiled ? process.hrtime.bigint() : 0n;
                const nationResult = runAction('nation', nationDefinitions, nationFallback, nationCommand, false);
                const nationActionDurationNs = options.onActionProfiled
                    ? process.hrtime.bigint() - nationActionStartedAt
                    : 0n;
                // Ref persists the nation command here, but LazyVarUpdater only
                // clears its dirty flags: it does not replace the same PHP
                // General object's fractional values with the MariaDB INT row.
                // The following general command therefore observes and adds to
                // those fractions before the turn's final persistence boundary.
                worldOverlay?.syncGeneral(currentGeneral);
                if (
                    worldView &&
                    (process.env.CORE_AI_TRACE_GENERAL_IDS?.split(',') ?? []).includes(String(currentGeneral.id))
                ) {
                    process.stdout.write(
                        `AI_DIPLOMACY_TRACE ${JSON.stringify({
                            generalId: currentGeneral.id,
                            stage: 'after-nation-action',
                            entries: worldView
                                .listDiplomacy()
                                .filter((entry) => entry.fromNationId === currentGeneral.nationId && entry.state <= 1),
                        })}\n`
                    );
                }
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
                options.onActionProfiled?.({
                    kind: 'nation',
                    generalId: currentGeneral.id,
                    nationId: currentNation?.id ?? null,
                    officerLevel: currentGeneral.officerLevel,
                    npcState: currentGeneral.npcState,
                    year: context.world.currentYear,
                    month: context.world.currentMonth,
                    requestedAction: nationCommand.action,
                    actionKey: nationResult.actionKey,
                    usedFallback: nationResult.usedFallback,
                    usedAi: nationUsedAi,
                    aiDecisionDurationNs: nationAiDecisionDurationNs,
                    actionDurationNs: nationActionDurationNs,
                });
                options.reservedTurns.shiftNationTurns(currentNation.id, currentGeneral.officerLevel, -1);
            }
            if (isBlocked && currentNation && currentGeneral.officerLevel >= 5) {
                options.reservedTurns.shiftNationTurns(currentNation.id, currentGeneral.officerLevel, -1);
            }

            let generalCommand = options.reservedTurns.getGeneralTurn(currentGeneral.id, 0);
            if ((process.env.CORE_AI_TRACE_GENERAL_IDS?.split(',') ?? []).includes(String(currentGeneral.id))) {
                process.stdout.write(
                    `RESERVED_TURN_HANDLER_TRACE ${JSON.stringify({
                        generalId: currentGeneral.id,
                        action: generalCommand.action,
                        actionLength: generalCommand.action.length,
                        actionCodePoints: Array.from(generalCommand.action).map((value) => value.codePointAt(0)),
                        hasDefinition: generalDefinitions.has(generalCommand.action),
                    })}\n`
                );
            }
            if (!isBlocked && generalCommand.action !== DEFAULT_ACTION) {
                hasReservedTurn = true;
            }
            let generalAiState: ReturnType<GeneralAI['getDebugState']> | undefined;
            let generalAutorunMode = false;
            let generalAiDecisionDurationNs = 0n;
            let generalUsedAi = false;
            if (!isBlocked && worldView && shouldUseAi(currentGeneral, context.world)) {
                generalUsedAi = true;
                const aiStartedAt = options.onActionProfiled ? process.hrtime.bigint() : 0n;
                const ai =
                    sharedAi ??
                    new GeneralAI({
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
                if (options.onActionProfiled) {
                    generalAiDecisionDurationNs = process.hrtime.bigint() - aiStartedAt;
                }
                // Ref GeneralAI::calcDiplomacyState writes
                // nation_env.last_attackable for ordinary generals too. The
                // nation-turn path consumes this patch above, but most NPCs
                // never execute a nation turn.
                const generalAiNationState = ai.consumePromotionPatches();
                if (generalAiNationState.nationMeta && currentNation) {
                    currentNation = {
                        ...currentNation,
                        meta: generalAiNationState.nationMeta as Nation['meta'],
                    };
                    worldOverlay?.applyNationPatch(currentNation.id, { meta: currentNation.meta });
                }
                const npcMessage = ai.consumeNpcMessage();
                if (npcMessage) {
                    const messageTarget = {
                        generalId: currentGeneral.id,
                        generalName: currentGeneral.name,
                        nationId: currentGeneral.nationId,
                        nationName: currentNation?.name ?? '재야',
                        color: currentNation?.color ?? '#000000',
                        icon: currentGeneral.picture ?? '',
                    };
                    messages.push({
                        msgType: 'public',
                        src: messageTarget,
                        dest: messageTarget,
                        text: npcMessage,
                        time: options.now?.() ?? new Date(context.world.lastTurnTime),
                        validUntil: new Date('9999-12-31T00:00:00.000Z'),
                        option: {},
                    });
                }
                if (candidate) {
                    generalAutorunMode =
                        candidate.action !== generalCommand.action ||
                        JSON.stringify(candidate.args ?? {}) !== JSON.stringify(generalCommand.args ?? {});
                    generalCommand = { action: candidate.action, args: candidate.args };
                }
                const aiMetaPatch = ai.consumePersistentGeneralMetaPatch();
                if (Object.keys(aiMetaPatch.set).length > 0 || aiMetaPatch.unset.length > 0) {
                    const nextMeta = { ...currentGeneral.meta } as Record<string, unknown>;
                    for (const key of aiMetaPatch.unset) {
                        delete nextMeta[key];
                    }
                    currentGeneral = {
                        ...currentGeneral,
                        meta: { ...nextMeta, ...aiMetaPatch.set } as TurnGeneral['meta'],
                    };
                    worldOverlay?.syncGeneral(currentGeneral);
                }
                generalAiState = ai.getDebugState();
            }
            // che_은퇴 performs the rebirth inside the action, as Ref does. Preserve
            // the fully accumulated pre-command state so lifecycle persistence can
            // settle Hall/inheritance before observing that reset.
            const explicitRetirementSnapshot = cloneTurnGeneral(currentGeneral);
            const generalActionStartedAt = options.onActionProfiled ? process.hrtime.bigint() : 0n;
            const generalResult = isBlocked
                ? {
                      actionKey: DEFAULT_ACTION,
                      usedFallback: true,
                      completed: false,
                      blockedReason: '블럭 대상자입니다.',
                  }
                : runAction('general', generalDefinitions, generalFallback, generalCommand, true);
            const generalActionDurationNs = options.onActionProfiled
                ? process.hrtime.bigint() - generalActionStartedAt
                : 0n;
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
            options.onActionProfiled?.({
                kind: 'general',
                generalId: currentGeneral.id,
                nationId: currentNation?.id ?? null,
                officerLevel: currentGeneral.officerLevel,
                npcState: currentGeneral.npcState,
                year: context.world.currentYear,
                month: context.world.currentMonth,
                requestedAction: generalCommand.action,
                actionKey: generalResult.actionKey,
                usedFallback: generalResult.usedFallback,
                usedAi: generalUsedAi,
                aiDecisionDurationNs: generalAiDecisionDurationNs,
                actionDurationNs: generalActionDurationNs,
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

            const explicitlyRetired = generalResult.actionKey === 'che_은퇴' && generalResult.completed;
            let lifecycleOutcome: 'active' | 'detached' | 'deleted' | 'retired' = explicitlyRetired
                ? 'retired'
                : 'active';
            let deleteGeneral = false;
            const deletedTroopIds = Array.from(commandDeletedTroopIds);
            const lifecycleSnapshot = cloneTurnGeneral(currentGeneral);
            if (currentGeneral.meta.killturn <= 0) {
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
                        createGeneralActionLog(
                            currentGeneral.id,
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
                                createGeneralActionLog(
                                    currentGeneral.id,
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
                logs.push(
                    createGeneralActionLog(currentGeneral.id, '나이가 들어 <R>은퇴</>하고 자손에게 자리를 물려줍니다.')
                );
            }

            currentGeneral = {
                ...currentGeneral,
                triggerState: {
                    ...currentGeneral.triggerState,
                    flags: {},
                },
            };

            if ((process.env.CORE_AI_TRACE_GENERAL_IDS?.split(',') ?? []).includes(String(currentGeneral.id))) {
                process.stdout.write(
                    `AI_GENERAL_PRE_APPLY_TRACE ${JSON.stringify({ engine: 'core', generalId: currentGeneral.id, stats: currentGeneral.stats, experience: currentGeneral.experience, dedication: currentGeneral.dedication, meta: { leadership_exp: currentGeneral.meta.leadership_exp, strength_exp: currentGeneral.meta.strength_exp, intel_exp: currentGeneral.meta.intel_exp, dex1: currentGeneral.meta.dex1, dex2: currentGeneral.meta.dex2, dex3: currentGeneral.meta.dex3, dex4: currentGeneral.meta.dex4, dex5: currentGeneral.meta.dex5 } })}\n`
                );
            }

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
                ...(destroyedNationIds.size > 0 ? { destroyedNationIds: [...destroyedNationIds] } : undefined),
                lifecycleEvent: {
                    generalId: currentGeneral.id,
                    outcome: lifecycleOutcome,
                    before:
                        lifecycleOutcome === 'active'
                            ? lifecycleBefore
                            : explicitlyRetired
                              ? explicitRetirementSnapshot
                              : lifecycleSnapshot,
                    ...(deleteGeneral ? {} : { after: currentGeneral }),
                    isUnitedAtEvent: readMetaNumber(
                        asRecord(context.world.meta),
                        'isunited',
                        readMetaNumber(asRecord(context.world.meta), 'isUnited', 0)
                    ),
                    year: context.world.currentYear,
                    month: context.world.currentMonth,
                },
            };

            return result;
        },
    };
};

export type ImmediateGeneralActionKey = 'che_거병' | 'che_접경귀환' | 'che_등용수락';

export type ImmediateGeneralActionExecutor = {
    execute(input: {
        actionKey: ImmediateGeneralActionKey;
        generalId: number;
        rng: RandUtil;
        args?: Record<string, unknown>;
        refreshKillturn?: boolean;
    }): Promise<{ ok: boolean; reason?: string }>;
};

/**
 * Ref의 MyPage 즉시 행동은 예약 턴과 같은 command/action-module stack을
 * 실행하지만 장수의 turnTime과 예약 큐는 진행시키지 않는다.
 */
export const createImmediateGeneralActionExecutor = async (options: {
    world: InMemoryTurnWorld;
    reservedTurns?: InMemoryReservedTurnStore;
    scenarioMeta?: ScenarioMeta;
    map?: MapDefinition;
    commandProfile?: TurnCommandProfile;
    getAdditionalOccupiedUniqueItemKeys?: () =>
        Iterable<string | null | undefined> | Promise<Iterable<string | null | undefined>>;
}): Promise<ImmediateGeneralActionExecutor> => {
    const env = buildCommandEnv(options.world.getScenarioConfig(), options.world.getUnitSet());
    const commandProfile = options.commandProfile ?? DEFAULT_TURN_COMMAND_PROFILE;
    // 등용수락은 예약 화면에 노출되는 명령이 아니라 등용 서신의 응답이
    // 직접 실행하는 내부 명령이다. 선택 가능 명령 프로필에 없더라도 등용
    // 서신을 수락할 수 있도록 즉시 행동 정의에는 항상 포함한다.
    const immediateCommandProfile: TurnCommandProfile = commandProfile.general.includes('che_등용수락')
        ? commandProfile
        : {
              ...commandProfile,
              general: [...commandProfile.general, 'che_등용수락'],
          };
    const { general: definitions } = await buildReservedTurnDefinitions({
        env,
        commandProfile: immediateCommandProfile,
        defaultActionKey: DEFAULT_ACTION,
    });
    const generalModuleLoader = new GeneralTurnCommandLoader();
    const contextBuilders = new Map<string, ActionContextBuilder>();
    for (const actionKey of ['che_거병', 'che_접경귀환', 'che_등용수락'] as const) {
        if (!definitions.has(actionKey)) {
            continue;
        }
        const module = await generalModuleLoader.load(actionKey);
        contextBuilders.set(actionKey, module.actionContextBuilder ?? defaultActionContextBuilder);
    }

    const itemRegistry = createItemModuleRegistry(await loadItemModules([...ITEM_KEYS]));
    const uniqueConfig = resolveUniqueConfig(asRecord(options.world.getScenarioConfig().const));
    const inheritItemRandomPoint = readMetaNumber(
        asRecord(options.world.getScenarioConfig().const),
        'inheritItemRandomPoint',
        3_000
    );
    if (Object.keys(uniqueConfig.allItems).length === 0) {
        uniqueConfig.allItems = buildLegacyDefaultUniqueItemPool(itemRegistry);
    }

    return {
        async execute(input) {
            const definition = definitions.get(input.actionKey);
            if (!definition) {
                return {
                    ok: false,
                    reason: `${input.actionKey}을 실행할 수 없는 모드입니다.`,
                };
            }

            const general = options.world.getGeneralById(input.generalId);
            if (!general) {
                return { ok: false, reason: '장수 정보를 찾을 수 없습니다.' };
            }
            const city = options.world.getCityById(general.cityId) ?? undefined;
            const nation = general.nationId > 0 ? options.world.getNationById(general.nationId) : null;
            const args = definition.parseArgs(input.args ?? {});
            if (args === null) {
                return { ok: false, reason: '인자가 올바르지 않습니다.' };
            }

            const state = options.world.getState();
            const constraintEnv = {
                ...resolveConstraintEnv(state, options.scenarioMeta, env),
                ...(options.map ? { map: options.map } : {}),
                ...(options.world.getUnitSet() ? { unitSet: options.world.getUnitSet() } : {}),
                cities: options.world.listCities(),
                nations: options.world.listNations(),
            };
            const constraintArgs = withCanonicalArgumentAliases(extractArgsRecord(args));
            const constraintCtx = buildConstraintContext(general, city, nation, constraintArgs, constraintEnv);
            const view = new WorldStateView(options.world, constraintEnv, constraintArgs, {
                general,
                city,
                nation,
            });
            const constraintResult = evaluateConstraints(
                definition.buildConstraints(constraintCtx, args),
                constraintCtx,
                view
            );
            if (constraintResult.kind !== 'allow') {
                const reason =
                    constraintResult.kind === 'deny' ? constraintResult.reason : '조건을 확인할 수 없습니다.';
                const failureText =
                    definition.formatConstraintFailure?.(reason, constraintCtx, args, view) ??
                    `${reason} ${definition.name} 실패.`;
                if (input.actionKey === 'che_접경귀환') {
                    options.world.pushLog(createGeneralActionLog(general.id, failureText), general.turnTime);
                }
                return { ok: false, reason: failureText };
            }

            if (input.actionKey === 'che_거병' && !options.reservedTurns) {
                throw new Error('Immediate uprising requires the reserved-turn store.');
            }

            const additionalOccupiedUniqueItemKeys = (await options.getAdditionalOccupiedUniqueItemKeys?.()) ?? [];
            const seedBase = buildSeedBase(state);
            const uniqueLottery = buildUniqueLotteryRunner({
                world: state,
                worldView: options.world,
                scenarioMeta: options.scenarioMeta,
                seedBase,
                itemRegistry,
                uniqueConfig,
                inheritItemRandomPoint,
                inheritanceWorld: options.world,
                getAdditionalOccupiedUniqueItemKeys: () => additionalOccupiedUniqueItemKeys,
            });
            const startYear = resolveStartYear(state, options.scenarioMeta);
            const baseContext: ActionContextBase = {
                general,
                city,
                nation,
                worldView: {
                    listGenerals: () => options.world.listGenerals(),
                    listGeneralsByCity: (cityId) =>
                        options.world.listGenerals().filter((candidate) => candidate.cityId === cityId),
                    listNations: () => options.world.listNations(),
                },
                rng: input.rng,
                time: {
                    year: state.currentYear,
                    month: state.currentMonth,
                    startYear,
                },
                maxTechLevel: env.maxTechLevel,
                uniqueLottery,
                legacyStaticNationName: nation?.name ?? '재야',
            };
            const actionContext =
                buildActionContext(
                    input.actionKey,
                    baseContext,
                    {
                        world: state,
                        scenarioConfig: options.world.getScenarioConfig(),
                        scenarioMeta: options.scenarioMeta,
                        map: options.map,
                        unitSet: options.world.getUnitSet(),
                        worldRef: options.world,
                        actionArgs: constraintArgs,
                        createGeneralId: () => options.world.getNextGeneralId(),
                        createNationId: () => options.world.getNextNationId(),
                        seedBase,
                    },
                    contextBuilders
                ) ?? baseContext;

            const resolution = resolveGeneralAction(
                definition,
                actionContext,
                {
                    now: general.turnTime,
                    schedule: {
                        entries: [
                            {
                                startMinute: 0,
                                tickMinutes: Math.max(1, Math.floor(state.tickSeconds / 60)),
                            },
                        ],
                    },
                },
                args
            );

            if (input.actionKey === 'che_접경귀환' && (resolution.general as TurnGeneral).cityId === general.cityId) {
                for (const log of orderLegacyActionLoggerFlush([
                    ...resolution.logs,
                    ...resolution.postProgressionLogs,
                ])) {
                    options.world.pushLog(log, general.turnTime);
                }
                return { ok: false, reason: '가까운 아국 도시가 없습니다.' };
            }

            const progressionLogs: LogEntryDraft[] = [];
            let nextGeneral = resolution.general as TurnGeneral;
            const activeActionAmount =
                (
                    definition as GeneralActionDefinition & {
                        getInheritanceActiveActionAmount?: (context: ActionContextBase, args: unknown) => number;
                    }
                ).getInheritanceActiveActionAmount?.(actionContext, args) ?? 0;
            if (
                Number.isFinite(activeActionAmount) &&
                activeActionAmount !== 0 &&
                canAccumulateInheritance(nextGeneral, asRecord(state.meta))
            ) {
                const pointAmount = activeActionAmount * 3;
                options.world.queueInheritancePointAdjustment(nextGeneral.userId, 'active_action', pointAmount);
                nextGeneral = {
                    ...nextGeneral,
                    inheritancePoints: {
                        ...nextGeneral.inheritancePoints,
                        active_action:
                            readInheritanceNumber(nextGeneral.inheritancePoints?.active_action) + pointAmount,
                    },
                    meta: {
                        ...nextGeneral.meta,
                        inherit_active_action:
                            readMetaNumber(asRecord(nextGeneral.meta), 'inherit_active_action', 0) + activeActionAmount,
                        ...(input.refreshKillturn
                            ? { killturn: readMetaNumber(asRecord(state.meta), 'killturn', 0) }
                            : {}),
                    },
                };
            }
            // Ref's immediate uprising and recruitment-accept commands both
            // finish their actor addExperience/addDedication calls before the
            // actor logger is applied. Keep the same level/rank state and logs
            // outside the ordinary reserved-turn lifecycle.
            if (input.actionKey === 'che_거병' || input.actionKey === 'che_등용수락') {
                nextGeneral = applyLegacyGeneralProgression(
                    {
                        ...nextGeneral,
                        // Ref's recruitment-letter acceptance is an immediate
                        // side action and never replaces the receiver's
                        // reserved-command repetition state.
                        lastTurn:
                            input.actionKey === 'che_등용수락'
                                ? general.lastTurn
                                : {
                                      command: definition.name,
                                      arg: extractArgsRecord(args),
                                  },
                    },
                    general,
                    input.actionKey,
                    env,
                    progressionLogs
                );
            }

            for (const createdNation of resolution.created?.nations ?? []) {
                if (!options.world.addNation(createdNation)) {
                    throw new Error(`Immediate action could not create nation ${createdNation.id}.`);
                }
                options.reservedTurns?.ensureNationTurns(createdNation.id, 12);
                options.reservedTurns?.ensureNationTurns(createdNation.id, 11);
            }
            if (resolution.dirty?.city && resolution.city) {
                options.world.updateCity(resolution.city.id, resolution.city);
            }
            if (resolution.dirty?.nation && resolution.nation) {
                options.world.updateNation(resolution.nation.id, resolution.nation);
            }
            for (const patch of resolution.patches?.generals ?? []) {
                options.world.updateGeneral(patch.id, patch.patch as Partial<TurnGeneral>);
            }
            for (const patch of resolution.patches?.cities ?? []) {
                options.world.updateCity(patch.id, patch.patch);
            }
            for (const patch of resolution.patches?.nations ?? []) {
                options.world.updateNation(patch.id, patch.patch);
            }
            for (const effect of resolution.effects) {
                if (effect.type === 'diplomacy:patch') {
                    options.world.applyDiplomacyPatch({
                        srcNationId: effect.srcNationId,
                        destNationId: effect.destNationId,
                        patch: effect.patch,
                    });
                } else if (effect.type === 'message:add') {
                    options.world.queueMessage(effect.draft);
                }
            }
            for (const troopId of resolution.deletedTroopIds ?? []) {
                options.world.removeTroop(troopId);
            }
            for (const log of orderLegacyCommandLogs(
                input.actionKey,
                resolution.logs,
                progressionLogs,
                resolution.postProgressionLogs
            )) {
                options.world.pushLog(log, general.turnTime);
            }
            options.world.updateGeneral(input.generalId, nextGeneral);
            return { ok: true };
        },
    };
};
