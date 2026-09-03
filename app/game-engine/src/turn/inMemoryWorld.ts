import type {
    City,
    LogEntryDraft,
    MessageDraft,
    Nation,
    ScenarioConfig,
    ScenarioGeneralPoolCandidate,
    Troop,
    TurnSchedule,
    UnitSetDefinition,
} from '@sammo-ts/logic';
import { getNextTurnAt, readScenarioGeneralPoolClaim } from '@sammo-ts/logic';
import {
    GAME_TICKS_PER_TURN,
    GameClock,
    assertGameplayCommitAllowed,
    inferClockPhase,
    type GameClockMode,
    type GameClockPhase,
} from '@sammo-ts/common';

import type { TurnCheckpoint } from '../lifecycle/types.js';
import type {
    PendingNeutralAuction,
    PendingNationBettingFinish,
    PendingNationBettingOpen,
    PendingUnificationFinalization,
    PendingYearbookSnapshot,
    TurnDiplomacy,
    TurnEvent,
    TurnGeneral,
    TurnGeneralPoolEntry,
    TurnWorldSnapshot,
    TurnWorldState,
} from './types.js';
import {
    applyDiplomacyPatch as applyDiplomacyPatchToEntry,
    buildDefaultDiplomacy,
    buildDiplomacyKey,
    processDiplomacyMonth,
    type DiplomacyPatch,
} from '@sammo-ts/logic';

export interface GeneralTurnContext {
    general: TurnGeneral;
    city?: City;
    nation?: Nation | null;
    world: TurnWorldState;
    schedule: TurnSchedule;
}

export interface GeneralTurnResult {
    general?: TurnGeneral;
    city?: City;
    nation?: Nation | null;
    nextTurnAt?: Date;
    logs?: LogEntryDraft[];
    messages?: MessageDraft[];
    patches?: {
        generals: Array<{ id: number; patch: Partial<TurnGeneral> }>;
        cities: Array<{ id: number; patch: Partial<City> }>;
        nations: Array<{ id: number; patch: Partial<Nation> }>;
        troops: Array<{ id: number; patch: Partial<Troop> }>;
    };
    diplomacyPatches?: Array<{
        srcNationId: number;
        destNationId: number;
        patch: DiplomacyPatch;
    }>;
    created?: {
        generals: TurnGeneral[];
        nations?: Nation[];
        troops?: Troop[];
    };
    deleted?: {
        general: boolean;
        troopIds?: number[];
    };
    destroyedNationIds?: number[];
    lifecycleEvent?: GeneralLifecycleEvent;
}

export interface GeneralTurnExecution {
    nextTurnAt: Date;
    destroyedNationIds: number[];
}

export interface GeneralLifecycleEvent {
    generalId: number;
    outcome: 'active' | 'detached' | 'deleted' | 'retired';
    before: TurnGeneral;
    after?: TurnGeneral;
    /** World unification state observed when this lifecycle transition occurred. */
    isUnitedAtEvent?: number;
    year: number;
    month: number;
}

export interface GeneralTurnHandler {
    // 장수 턴 처리 결과를 반영하기 위한 확장 포인트.
    execute(context: GeneralTurnContext): GeneralTurnResult;
}

export interface TurnCalendarContext {
    previousYear: number;
    previousMonth: number;
    currentYear: number;
    currentMonth: number;
    turnTime: Date;
    legacyTurnTime?: Date;
}

export interface TurnCalendarHandler {
    // 레거시 PRE_MONTH는 날짜 변경 전, MONTH는 날짜 변경 후에 실행된다.
    beforeMonthChanged?(context: TurnCalendarContext): void | Promise<void>;
    onMonthChanged?(context: TurnCalendarContext): void | Promise<void>;
    onYearChanged?(context: TurnCalendarContext): void | Promise<void>;
}

export interface InMemoryTurnWorldOptions {
    schedule: TurnSchedule;
    generalTurnHandler?: GeneralTurnHandler;
    calendarHandler?: TurnCalendarHandler;
    autoAdvanceDiplomacyMonth?: boolean;
}

export interface InMemoryGameClockState {
    baseTime: Date;
    tick: number;
    mode: GameClockMode;
    wallAnchor: Date;
    lastTurnTick: number;
    phase: GameClockPhase;
    revision: number;
    deadlineGeneration: number;
}

export interface DurableGameClockSnapshot extends InMemoryGameClockState {
    lastTurnTick: number;
}

export interface DurableClockReconciliationAlignment {
    suspensionId: string;
    sourceRevision: number;
    targetRevision: number;
    deadlineGeneration: number;
    alignedTick: number;
    shiftTicks: number;
    resumeWallAt: Date;
}

export type InheritancePersistencePhase = 'before_lifecycle' | 'after_lifecycle';

export interface PendingInheritancePointAdjustment {
    userId: string;
    key: string;
    amount: number;
    phase?: InheritancePersistencePhase;
}

export interface PendingInheritanceLog {
    userId: string;
    year: number;
    month: number;
    text: string;
    phase?: InheritancePersistencePhase;
}

export interface TurnWorldChanges {
    realtimeBacklogShiftTicks: number;
    accessScoreResetGeneralIds: number[];
    generals: TurnGeneral[];
    cities: City[];
    nations: Nation[];
    troops: Troop[];
    deletedTroops: number[];
    deletedGenerals: number[];
    deletedNations: number[];
    deletedNationSnapshots: Array<{ nation: Nation; generalIds: number[]; removedAt: Date }>;
    diplomacy: TurnDiplomacy[];
    logs: LogEntryDraft[];
    messages: MessageDraft[];
    createdGenerals: TurnGeneral[];
    createdNations: Nation[];
    createdTroops: Troop[];
    createdDiplomacy: TurnDiplomacy[];
    createdEvents: TurnEvent[];
    deletedEvents: number[];
    lifecycleEvents: GeneralLifecycleEvent[];
    pendingNeutralAuctions: PendingNeutralAuction[];
    inheritancePointAdjustments: PendingInheritancePointAdjustment[];
    pendingInheritanceLogs: PendingInheritanceLog[];
    pendingNationBettingOpens: PendingNationBettingOpen[];
    pendingNationBettingFinishes: PendingNationBettingFinish[];
    pendingYearbookSnapshots: PendingYearbookSnapshot[];
    pendingUnificationFinalizations: PendingUnificationFinalization[];
}

export interface InMemoryTurnWorldStateSnapshot {
    schedule: TurnSchedule;
    state: TurnWorldState;
    worldConfig: Record<string, unknown>;
    generalPoolEntries: TurnWorldSnapshot['generalPoolEntries'];
    checkpoint?: TurnCheckpoint;
    generals: Array<[number, TurnGeneral]>;
    cities: Array<[number, City]>;
    nations: Array<[number, Nation]>;
    troops: Array<[number, Troop]>;
    diplomacy: Array<[string, TurnDiplomacy]>;
    events: Array<[number, TurnEvent]>;
    dirtyGeneralIds: number[];
    dirtyCityIds: number[];
    dirtyNationIds: number[];
    dirtyTroopIds: number[];
    dirtyDiplomacyKeys: string[];
    accessScoreResetGeneralIds: number[];
    createdGeneralIds: number[];
    createdNationIds: number[];
    createdTroopIds: number[];
    createdDiplomacyKeys: string[];
    createdEventIds: number[];
    deletedTroopIds: number[];
    deletedGeneralIds: number[];
    deletedNationIds: number[];
    deletedEventIds: number[];
    deletedNationSnapshots: Array<{ nation: Nation; generalIds: number[]; removedAt: Date }>;
    logs: LogEntryDraft[];
    messages: MessageDraft[];
    lifecycleEvents: GeneralLifecycleEvent[];
    pendingNeutralAuctions: PendingNeutralAuction[];
    inheritancePointAdjustments: PendingInheritancePointAdjustment[];
    pendingInheritanceLogs: PendingInheritanceLog[];
    pendingNationBettingOpens: PendingNationBettingOpen[];
    pendingNationBettingFinishes: PendingNationBettingFinish[];
    pendingYearbookSnapshots: PendingYearbookSnapshot[];
    pendingUnificationFinalizations: PendingUnificationFinalization[];
    pendingRealtimeBacklogShiftTicks: number;
}

export interface InMemoryTurnWorldInspection {
    state: TurnWorldState;
    worldConfig: Record<string, unknown>;
    checkpoint?: TurnCheckpoint;
    generals: TurnGeneral[];
    cities: City[];
    nations: Nation[];
    troops: Troop[];
    diplomacy: TurnDiplomacy[];
    events: TurnEvent[];
    changes: TurnWorldChanges;
}

const compareTurnOrder = (left: TurnGeneral, right: TurnGeneral): number => {
    if (left.turnTick !== undefined && right.turnTick !== undefined) {
        const tickDiff = left.turnTick - right.turnTick;
        if (tickDiff !== 0) {
            return tickDiff;
        }
    }
    const timeDiff = left.turnTime.getTime() - right.turnTime.getTime();
    if (timeDiff !== 0) {
        return timeDiff;
    }
    return left.id - right.id;
};

const shouldProcessByCheckpoint = (general: TurnGeneral, checkpoint?: TurnCheckpoint): boolean => {
    if (!checkpoint) {
        return true;
    }
    if (general.turnTick !== undefined && checkpoint.turnTick !== undefined) {
        if (general.turnTick < checkpoint.turnTick) {
            return false;
        }
        if (general.turnTick > checkpoint.turnTick) {
            return true;
        }
        if (checkpoint.generalId === undefined) {
            return false;
        }
        return general.id > checkpoint.generalId;
    }
    const generalTime = general.turnTime.getTime();
    const checkpointTime = new Date(checkpoint.turnTime).getTime();
    if (generalTime < checkpointTime) {
        return false;
    }
    if (generalTime > checkpointTime) {
        return true;
    }
    if (checkpoint.generalId === undefined) {
        return false;
    }
    return general.id > checkpoint.generalId;
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

const toLegacyDatabaseInt = (value: number): number => {
    if (!Number.isFinite(value)) return 0;
    return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
};

const LEGACY_INTEGER_GENERAL_META_KEYS = [
    'leadership_exp',
    'strength_exp',
    'intel_exp',
    'dex1',
    'dex2',
    'dex3',
    'dex4',
    'dex5',
    'explevel',
    'dedlevel',
    'killturn',
    'myset',
] as const;

const normalizeGeneralMetaDatabaseIntegers = (meta: TurnGeneral['meta']): TurnGeneral['meta'] => {
    const normalized = { ...meta };
    for (const key of LEGACY_INTEGER_GENERAL_META_KEYS) {
        const value = normalized[key];
        if (typeof value === 'number') {
            normalized[key] = toLegacyDatabaseInt(value);
        }
    }
    return normalized;
};

// Ref writes these values to MariaDB integer columns after every general turn.
// Keeping fractional action results in memory until the monthly flush changes
// later aggregation (notably nation power), even if the eventual DB rows look
// identical after they are rounded.
export const normalizeGeneralDatabaseIntegers = (general: TurnGeneral): TurnGeneral => ({
    ...general,
    nationId: toLegacyDatabaseInt(general.nationId),
    cityId: toLegacyDatabaseInt(general.cityId),
    troopId: toLegacyDatabaseInt(general.troopId),
    stats: {
        leadership: toLegacyDatabaseInt(general.stats.leadership),
        strength: toLegacyDatabaseInt(general.stats.strength),
        intelligence: toLegacyDatabaseInt(general.stats.intelligence),
    },
    experience: toLegacyDatabaseInt(general.experience),
    dedication: toLegacyDatabaseInt(general.dedication),
    officerLevel: toLegacyDatabaseInt(general.officerLevel),
    injury: toLegacyDatabaseInt(general.injury),
    gold: toLegacyDatabaseInt(general.gold),
    rice: toLegacyDatabaseInt(general.rice),
    crew: toLegacyDatabaseInt(general.crew),
    crewTypeId: toLegacyDatabaseInt(general.crewTypeId),
    train: toLegacyDatabaseInt(general.train),
    atmos: toLegacyDatabaseInt(general.atmos),
    age: toLegacyDatabaseInt(general.age),
    npcState: toLegacyDatabaseInt(general.npcState),
    meta: normalizeGeneralMetaDatabaseIntegers(general.meta),
});

const applyGeneralPatch = (base: TurnGeneral, patch: Partial<TurnGeneral>): TurnGeneral =>
    normalizeGeneralDatabaseIntegers({
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

const applyTroopPatch = (base: Troop, patch: Partial<Troop>): Troop => ({
    ...base,
    ...patch,
});

const normalizeGeneralTurnTime = (general: TurnGeneral, fallback: Date): TurnGeneral => {
    const raw = general.turnTime as unknown;
    const parsed = raw instanceof Date ? raw : raw ? new Date(raw as string) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) {
        return {
            ...general,
            turnTime: new Date(fallback.getTime()),
        };
    }
    return {
        ...general,
        turnTime: parsed,
    };
};

const readMetaNumber = (meta: Record<string, unknown>, key: string): number | null => {
    const value = meta[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return null;
};

const shiftGameClockMetaDate = (value: unknown, deltaMilliseconds: number): unknown => {
    if (typeof value !== 'string' || !value.trim()) {
        return value;
    }
    if (value.includes('T')) {
        const shifted = new Date(new Date(value).getTime() + deltaMilliseconds);
        return Number.isNaN(shifted.getTime()) ? value : shifted.toISOString();
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})[ ](\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?$/.exec(value);
    if (!match) {
        return value;
    }
    const parts = match.slice(1).map(Number);
    const shifted = new Date(
        Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!, parts[3]!, parts[4]!, parts[5]!) + deltaMilliseconds
    );
    return (
        [
            shifted.getUTCFullYear().toString().padStart(4, '0'),
            (shifted.getUTCMonth() + 1).toString().padStart(2, '0'),
            shifted.getUTCDate().toString().padStart(2, '0'),
        ].join('-') +
        ' ' +
        [
            shifted.getUTCHours().toString().padStart(2, '0'),
            shifted.getUTCMinutes().toString().padStart(2, '0'),
            shifted.getUTCSeconds().toString().padStart(2, '0'),
        ].join(':') +
        (match[7] ?? '')
    );
};

const resolveWorldKillturn = (meta: Record<string, unknown>): number | null => {
    const killturn = readMetaNumber(meta, 'killturn');
    if (killturn !== null) {
        return Math.floor(killturn);
    }
    return null;
};

const ensureGeneralKillturn = (general: TurnGeneral, worldKillturn: number | null): TurnGeneral => {
    const meta = { ...general.meta } as Record<string, unknown>;
    const existing = readMetaNumber(meta, 'killturn');
    if (existing !== null) {
        return general;
    }
    if (worldKillturn === null) {
        throw new Error(`meta.killturn is required (generalId=${general.id}).`);
    }
    return {
        ...general,
        meta: {
            ...meta,
            killturn: worldKillturn,
        },
    };
};

export class InMemoryTurnWorld {
    // DB에서 읽어온 월드 상태를 메모리에 고정해 턴 처리를 담당한다.
    private schedule: TurnSchedule;
    private readonly generalTurnHandler: GeneralTurnHandler;
    private readonly calendarHandler?: TurnCalendarHandler;
    private readonly autoAdvanceDiplomacyMonth: boolean;
    private readonly generals = new Map<number, TurnGeneral>();
    private readonly cities = new Map<number, City>();
    private readonly nations = new Map<number, Nation>();
    private readonly troops = new Map<number, Troop>();
    private readonly diplomacy = new Map<string, TurnDiplomacy>();
    private readonly events = new Map<number, TurnEvent>();
    private readonly dirtyGeneralIds = new Set<number>();
    private readonly dirtyCityIds = new Set<number>();
    private readonly dirtyNationIds = new Set<number>();
    private readonly dirtyTroopIds = new Set<number>();
    private readonly dirtyDiplomacyKeys = new Set<string>();
    private readonly accessScoreResetGeneralIds = new Set<number>();
    private readonly createdGeneralIds = new Set<number>();
    private nextLegacyGeneralScanOrder = 0;
    private readonly createdNationIds = new Set<number>();
    private readonly createdTroopIds = new Set<number>();
    private readonly createdDiplomacyKeys = new Set<string>();
    private readonly createdEventIds = new Set<number>();
    private readonly deletedTroopIds = new Set<number>();
    private readonly deletedGeneralIds = new Set<number>();
    private readonly deletedNationIds = new Set<number>();
    private readonly deletedEventIds = new Set<number>();
    private readonly deletedNationSnapshots: Array<{
        nation: Nation;
        generalIds: number[];
        removedAt: Date;
    }> = [];
    private readonly logs: LogEntryDraft[] = [];
    private readonly messages: MessageDraft[] = [];
    private readonly lifecycleEvents: GeneralLifecycleEvent[] = [];
    private readonly pendingNeutralAuctions: PendingNeutralAuction[] = [];
    private readonly inheritancePointAdjustments: PendingInheritancePointAdjustment[] = [];
    private readonly pendingInheritanceLogs: PendingInheritanceLog[] = [];
    private readonly pendingNationBettingOpens: PendingNationBettingOpen[] = [];
    private readonly pendingNationBettingFinishes: PendingNationBettingFinish[] = [];
    private readonly pendingYearbookSnapshots: PendingYearbookSnapshot[] = [];
    private readonly pendingUnificationFinalizations: PendingUnificationFinalization[] = [];
    private pendingRealtimeBacklogShiftTicks = 0;
    private readonly scenarioConfig: ScenarioConfig;
    private generalPoolEntries: TurnWorldSnapshot['generalPoolEntries'];
    private readonly worldConfig: Record<string, unknown>;
    private readonly unitSet?: UnitSetDefinition;
    private checkpoint?: TurnCheckpoint;
    private state: TurnWorldState;

    constructor(state: TurnWorldState, snapshot: TurnWorldSnapshot, options: InMemoryTurnWorldOptions) {
        const baseTime = new Date((state.clockBaseTime ?? state.lastTurnTime).getTime());
        const mode = state.clockMode ?? 'manual';
        const phase = state.clockPhase ?? inferClockPhase(mode);
        const revision = state.clockRevision ?? 1;
        const deadlineGeneration = state.deadlineGeneration ?? 1;
        const wallAnchor = new Date((state.clockWallAnchor ?? state.lastTurnTime).getTime());
        const bootstrapClock = new GameClock({
            baseTime,
            tick: state.clockTick ?? 0,
            mode,
            wallAnchor,
            turnSeconds: state.tickSeconds,
            phase,
            revision,
        });
        const lastTurnTick = state.lastTurnTick ?? bootstrapClock.dateToTick(state.lastTurnTime);
        const clockTick = state.clockTick ?? lastTurnTick;
        const gameClock = new GameClock({
            baseTime,
            tick: clockTick,
            mode,
            wallAnchor,
            turnSeconds: state.tickSeconds,
            phase,
            revision,
        });
        const lastTurnTime = gameClock.tickToDate(lastTurnTick);
        this.state = {
            ...state,
            clockBaseTime: baseTime,
            clockTick,
            clockMode: mode,
            clockWallAnchor: wallAnchor,
            lastTurnTick,
            clockPhase: phase,
            clockRevision: revision,
            deadlineGeneration,
            lastTurnTime,
            meta: { ...state.meta, lastTurnTime: lastTurnTime.toISOString() },
        };
        this.scenarioConfig = snapshot.scenarioConfig;
        this.generalPoolEntries = snapshot.generalPoolEntries
            ? snapshot.generalPoolEntries.map((entry) => ({
                  ...entry,
                  reservedUntil: entry.reservedUntil ? new Date(entry.reservedUntil.getTime()) : null,
                  candidate: structuredClone(entry.candidate),
              }))
            : undefined;
        // Runtime callbacks created before the world keep the original object
        // reference. Mutate this object in place so a live settings action is
        // observed by monthly handlers without restarting the daemon.
        this.worldConfig = snapshot.worldConfig ?? { ...snapshot.scenarioConfig };
        this.unitSet = snapshot.unitSet;
        this.schedule = options.schedule;
        this.generalTurnHandler =
            options.generalTurnHandler ??
            ({
                execute: () => ({}),
            } satisfies GeneralTurnHandler);
        this.calendarHandler = options.calendarHandler;
        this.autoAdvanceDiplomacyMonth = options.autoAdvanceDiplomacyMonth ?? true;

        const worldKillturn = resolveWorldKillturn(this.state.meta);
        for (const general of snapshot.generals) {
            const normalized = this.normalizeGeneralClock(
                normalizeGeneralTurnTime({ ...general }, this.state.lastTurnTime)
            );
            const existingOrder = normalized.meta.legacyScanOrder;
            const scanOrder =
                typeof existingOrder === 'number' && Number.isFinite(existingOrder)
                    ? existingOrder
                    : this.nextLegacyGeneralScanOrder;
            this.nextLegacyGeneralScanOrder = Math.max(this.nextLegacyGeneralScanOrder, scanOrder + 1);
            const ensured = ensureGeneralKillturn(
                { ...normalized, meta: { ...normalized.meta, legacyScanOrder: scanOrder } },
                worldKillturn
            );
            this.generals.set(general.id, ensured);
        }
        for (const city of snapshot.cities) {
            this.cities.set(city.id, { ...city });
        }
        for (const nation of snapshot.nations) {
            this.nations.set(nation.id, { ...nation });
        }
        for (const troop of snapshot.troops) {
            this.troops.set(troop.id, { ...troop });
        }
        for (const entry of snapshot.diplomacy) {
            const key = buildDiplomacyKey(entry.fromNationId, entry.toNationId);
            this.diplomacy.set(key, {
                ...entry,
                meta: { ...entry.meta },
            });
        }
        for (const event of snapshot.events) {
            this.events.set(event.id, { ...event, meta: { ...event.meta } });
        }
        this.ensureDiplomacyMatrix();
    }

    private getGameClock(): GameClock {
        return new GameClock({
            baseTime: this.state.clockBaseTime ?? this.state.lastTurnTime,
            tick: this.state.clockTick ?? this.state.lastTurnTick ?? 0,
            mode: this.state.clockMode ?? 'manual',
            wallAnchor: this.state.clockWallAnchor ?? this.state.lastTurnTime,
            turnSeconds: this.state.tickSeconds,
            phase: this.state.clockPhase ?? inferClockPhase(this.state.clockMode ?? 'manual'),
            revision: this.state.clockRevision ?? 1,
        });
    }

    private normalizeGeneralClock(general: TurnGeneral): TurnGeneral {
        const clock = this.getGameClock();
        const turnTick = general.turnTick ?? clock.dateToTick(general.turnTime);
        const recentWarTick =
            general.recentWarTick !== undefined
                ? general.recentWarTick
                : general.recentWarTime
                  ? clock.dateToTick(general.recentWarTime)
                  : null;
        return {
            ...general,
            turnTick,
            turnTime: clock.tickToDate(turnTick),
            recentWarTick,
            recentWarTime: recentWarTick === null ? null : clock.tickToDate(recentWarTick),
        };
    }

    getGameClockState(): InMemoryGameClockState {
        return {
            baseTime: new Date((this.state.clockBaseTime ?? this.state.lastTurnTime).getTime()),
            tick: this.state.clockTick ?? 0,
            mode: this.state.clockMode ?? 'manual',
            wallAnchor: new Date((this.state.clockWallAnchor ?? this.state.lastTurnTime).getTime()),
            lastTurnTick: this.state.lastTurnTick ?? 0,
            phase: this.state.clockPhase ?? inferClockPhase(this.state.clockMode ?? 'manual'),
            revision: this.state.clockRevision ?? 1,
            deadlineGeneration: this.state.deadlineGeneration ?? 1,
        };
    }

    getGameNow(wallNow: Date): Date {
        return this.getGameClock().now(wallNow);
    }

    promotePreopenAtOpening(wallNow: Date): boolean {
        const clock = this.getGameClock();
        if (clock.phase !== 'PREOPEN' || wallNow.getTime() < clock.wallAnchor.getTime()) {
            return false;
        }
        if (clock.tick !== 0) {
            throw new Error(`PREOPEN opening invariant requires clock tick zero, found ${clock.tick}.`);
        }
        this.state = {
            ...this.state,
            clockPhase: 'RUNNING',
        };
        return true;
    }

    beginUnificationWait(suspensionId: string): void {
        const phase = this.state.clockPhase ?? inferClockPhase(this.state.clockMode ?? 'manual');
        if (phase === 'SUSPENDED' && this.state.meta.unificationClockSuspensionId === suspensionId) {
            return;
        }
        if (phase !== 'RUNNING') {
            throw new Error(`UNIFICATION_WAIT can start only from RUNNING; current phase is ${phase}.`);
        }
        this.state = {
            ...this.state,
            clockPhase: 'SUSPENDED',
            meta: {
                ...this.state.meta,
                unificationClockSuspensionId: suspensionId,
            },
        };
    }

    completeGameClock(): void {
        const phase = this.state.clockPhase ?? inferClockPhase(this.state.clockMode ?? 'manual');
        if (phase === 'COMPLETED') return;
        if (phase !== 'RUNNING') {
            throw new Error(`Game clock can complete only from RUNNING; current phase is ${phase}.`);
        }
        this.state = { ...this.state, clockPhase: 'COMPLETED' };
    }

    private applyClockReconciliationAlignment(input: DurableClockReconciliationAlignment): void {
        if (
            !Number.isSafeInteger(input.alignedTick) ||
            !Number.isSafeInteger(input.shiftTicks) ||
            input.shiftTicks < 0 ||
            !Number.isSafeInteger(input.sourceRevision) ||
            !Number.isSafeInteger(input.targetRevision) ||
            input.targetRevision !== input.sourceRevision + 1 ||
            !Number.isSafeInteger(input.deadlineGeneration)
        ) {
            throw new Error('In-memory clock reconciliation received an unsafe coordinate.');
        }
        const clock = this.getGameClock();
        const shiftedMilliseconds = Math.trunc((input.shiftTicks * 1_000) / clock.ticksPerSecond);
        if (!Number.isSafeInteger(shiftedMilliseconds)) {
            throw new Error('In-memory clock reconciliation projection delta is unsafe.');
        }
        const lastTurnTick = clock.addTicks(this.state.lastTurnTick ?? 0, input.shiftTicks);
        const lastTurnTime = clock.tickToDate(lastTurnTick);
        this.state = {
            ...this.state,
            clockTick: input.alignedTick,
            clockWallAnchor: new Date(input.resumeWallAt.getTime()),
            lastTurnTick,
            lastTurnTime,
            clockPhase: 'RECONCILING',
            clockRevision: input.targetRevision,
            deadlineGeneration: input.deadlineGeneration,
            meta: {
                ...this.state.meta,
                lastTurnTime: lastTurnTime.toISOString(),
                turntime: shiftGameClockMetaDate(this.state.meta.turntime, shiftedMilliseconds),
                starttime: shiftGameClockMetaDate(this.state.meta.starttime, shiftedMilliseconds),
                tnmt_time: shiftGameClockMetaDate(this.state.meta.tnmt_time, shiftedMilliseconds),
            },
        };
        for (const [generalId, general] of this.generals) {
            const turnTick = clock.addTicks(general.turnTick ?? clock.dateToTick(general.turnTime), input.shiftTicks);
            this.generals.set(generalId, {
                ...general,
                turnTick,
                turnTime: clock.tickToDate(turnTick),
            });
        }
        for (const entry of this.generalPoolEntries ?? []) {
            if (entry.reservedUntilTick !== null) {
                entry.reservedUntilTick = clock.addTicks(entry.reservedUntilTick, input.shiftTicks);
                entry.reservedUntil = clock.tickToDate(entry.reservedUntilTick);
            } else if (entry.reservedUntil) {
                entry.reservedUntil = new Date(entry.reservedUntil.getTime() + shiftedMilliseconds);
            }
        }
        for (const auction of this.pendingNeutralAuctions) {
            auction.closeAt = new Date(auction.closeAt.getTime() + shiftedMilliseconds);
        }
        if (this.checkpoint) {
            const checkpointTick = clock.addTicks(
                this.checkpoint.turnTick ?? clock.dateToTick(new Date(this.checkpoint.turnTime)),
                input.shiftTicks
            );
            this.checkpoint = {
                ...this.checkpoint,
                turnTick: checkpointTick,
                turnTime: clock.tickToDate(checkpointTick).toISOString(),
            };
        }
    }

    applyClockReconciliation(input: Omit<DurableClockReconciliationAlignment, 'sourceRevision'>): void {
        const phase = this.state.clockPhase ?? inferClockPhase(this.state.clockMode ?? 'manual');
        if (phase !== 'SUSPENDED' || this.state.meta.unificationClockSuspensionId !== input.suspensionId) {
            throw new Error('In-memory clock reconciliation requires the matching UNIFICATION_WAIT suspension.');
        }
        this.applyClockReconciliationAlignment({
            ...input,
            sourceRevision: this.state.clockRevision ?? 1,
        });
    }

    applyDurableClockReconciliation(input: DurableClockReconciliationAlignment): void {
        const clock = this.getGameClockState();
        if (clock.revision === input.targetRevision && clock.phase === 'RECONCILING') {
            return;
        }
        if (clock.revision !== input.sourceRevision) {
            throw new Error(
                `Durable clock reconciliation source mismatch: memory ${clock.revision}, ledger ${input.sourceRevision}.`
            );
        }
        if (clock.phase !== 'RUNNING' && clock.phase !== 'SUSPENDED') {
            throw new Error(`Durable clock reconciliation cannot apply from in-memory phase ${clock.phase}.`);
        }
        this.applyClockReconciliationAlignment(input);
    }

    synchronizeDurableClockSnapshot(input: DurableGameClockSnapshot): void {
        const current = this.getGameClockState();
        if (current.revision !== input.revision || current.deadlineGeneration !== input.deadlineGeneration) {
            throw new Error(
                `Durable clock snapshot generation mismatch: memory ${current.revision}/${current.deadlineGeneration}, ` +
                    `database ${input.revision}/${input.deadlineGeneration}.`
            );
        }
        if ((this.state.lastTurnTick ?? 0) !== input.lastTurnTick) {
            throw new Error(
                `Durable clock snapshot turn cursor mismatch: memory ${this.state.lastTurnTick ?? 0}, database ${input.lastTurnTick}.`
            );
        }
        const currentBaseTime = this.state.clockBaseTime ?? this.state.lastTurnTime;
        if (currentBaseTime.getTime() !== input.baseTime.getTime()) {
            throw new Error(
                `Durable clock snapshot base mismatch: memory ${currentBaseTime.toISOString()}, ` +
                    `database ${input.baseTime.toISOString()}.`
            );
        }
        const validTransition =
            current.phase === input.phase ||
            (current.phase === 'RUNNING' && input.phase === 'SUSPENDED') ||
            (current.phase === 'RECONCILING' && input.phase === 'RUNNING');
        if (!validTransition) {
            throw new Error(`Durable clock snapshot phase mismatch: memory ${current.phase}, database ${input.phase}.`);
        }
        this.state = {
            ...this.state,
            clockBaseTime: new Date(input.baseTime.getTime()),
            clockTick: input.tick,
            clockMode: input.mode,
            clockWallAnchor: new Date(input.wallAnchor.getTime()),
            clockPhase: input.phase,
            clockRevision: input.revision,
            deadlineGeneration: input.deadlineGeneration,
        };
    }

    completeClockReconciliation(): void {
        if (this.state.clockPhase === 'RECONCILING') {
            this.state = { ...this.state, clockPhase: 'RUNNING' };
        }
    }

    getRunnableGameNow(wallNow: Date): Date {
        const clock = this.getGameClock();
        // PREOPEN still needs negative game ticks for cooldowns, but executable
        // turn schedules must not precede the wall-clock opening boundary.
        if (clock.phase === 'PREOPEN') {
            return clock.now(clock.wallAnchor);
        }
        return clock.now(wallNow);
    }

    dateToGameTick(date: Date): number {
        return this.getGameClock().dateToTick(date);
    }

    gameTickToDate(tick: number): Date {
        return this.getGameClock().tickToDate(tick);
    }

    advanceGameClockTo(target: Date, wallNow: Date): void {
        const clock = this.getGameClock();
        assertGameplayCommitAllowed(clock.phase);
        const targetTick = clock.dateToTick(target);
        // Realtime의 권위 시각은 wall anchor 이후 경과입니다. 밀린 턴을 과거
        // target으로 처리한 완료 시각에 anchor를 다시 고정하면, 처리에 걸린
        // 시간만큼 게임 시계가 매 pass마다 뒤로 누적됩니다.
        const observedTick = clock.mode === 'realtime' ? clock.nowTick(wallNow) : clock.tick;
        const nextTick = Math.max(observedTick, targetTick);
        this.state = {
            ...this.state,
            clockTick: nextTick,
            clockWallAnchor: new Date(wallNow.getTime()),
        };
    }

    private resolveRealtimeBacklogRebase(wallNow: Date): {
        clock: GameClock;
        wallAlignedTick: number;
        lastTurnTick: number;
        skippedTurns: number;
    } | null {
        const clock = this.getGameClock();
        if (clock.mode !== 'realtime' || clock.phase !== 'RUNNING') {
            return null;
        }
        const turnMinutes = Math.max(1, Math.round(this.state.tickSeconds / 60));
        const threshold = turnMinutes >= 20 ? 1 : turnMinutes >= 10 ? 3 : 6;
        const currentTick = clock.nowTick(wallNow);
        const wallAlignedTick = Math.max(currentTick, clock.dateToTick(wallNow));
        const lastTurnTick = this.state.lastTurnTick ?? clock.dateToTick(this.state.lastTurnTime);
        const skippedTurns = Math.floor((wallAlignedTick - lastTurnTick) / GAME_TICKS_PER_TURN);
        return skippedTurns > threshold ? { clock, wallAlignedTick, lastTurnTick, skippedTurns } : null;
    }

    shouldRebaseRealtimeBacklog(wallNow: Date): boolean {
        return this.resolveRealtimeBacklogRebase(wallNow) !== null;
    }

    rebaseRealtimeBacklog(wallNow: Date): {
        skippedTurns: number;
        shiftedTicks: number;
        lastTurnTime: string;
        checkpoint?: TurnCheckpoint;
    } | null {
        const plan = this.resolveRealtimeBacklogRebase(wallNow);
        if (!plan) {
            return null;
        }
        const { clock, wallAlignedTick, lastTurnTick, skippedTurns } = plan;
        // Ref realtime clock always projects the current wall time. Core may
        // already have accumulated lag from anchoring an overdue target, so a
        // long-backlog rebase also repairs that projection without rewinding.
        const shiftedTicks = skippedTurns * GAME_TICKS_PER_TURN;
        const shiftedMilliseconds = skippedTurns * this.state.tickSeconds * 1_000;
        const nextLastTurnTick = clock.addTicks(lastTurnTick, shiftedTicks);
        const nextLastTurnTime = clock.tickToDate(nextLastTurnTick);

        this.state = {
            ...this.state,
            clockTick: wallAlignedTick,
            clockWallAnchor: new Date(wallNow.getTime()),
            lastTurnTick: nextLastTurnTick,
            lastTurnTime: nextLastTurnTime,
            meta: {
                ...this.state.meta,
                lastTurnTime: nextLastTurnTime.toISOString(),
                turntime: shiftGameClockMetaDate(this.state.meta.turntime, shiftedMilliseconds),
                starttime: shiftGameClockMetaDate(this.state.meta.starttime, shiftedMilliseconds),
            },
        };

        // Ref checkDelay()는 한 번의 UPDATE로 전 장수의 다음 턴만 옮깁니다.
        // recent-war를 비롯한 이미 발생한 gameplay 시각은 그대로 보존합니다.
        for (const [generalId, general] of this.generals) {
            const turnTick = clock.addTicks(general.turnTick ?? clock.dateToTick(general.turnTime), shiftedTicks);
            this.generals.set(generalId, {
                ...general,
                turnTick,
                turnTime: clock.tickToDate(turnTick),
            });
        }
        for (const entry of this.generalPoolEntries ?? []) {
            if (entry.reservedUntilTick !== null) {
                entry.reservedUntilTick = clock.addTicks(entry.reservedUntilTick, shiftedTicks);
                entry.reservedUntil = clock.tickToDate(entry.reservedUntilTick);
            } else if (entry.reservedUntil) {
                entry.reservedUntil = new Date(entry.reservedUntil.getTime() + shiftedMilliseconds);
            }
        }
        if (this.checkpoint) {
            const checkpointTick = clock.addTicks(
                this.checkpoint.turnTick ?? clock.dateToTick(new Date(this.checkpoint.turnTime)),
                shiftedTicks
            );
            this.checkpoint = {
                ...this.checkpoint,
                turnTick: checkpointTick,
                turnTime: clock.tickToDate(checkpointTick).toISOString(),
            };
        }
        this.pendingRealtimeBacklogShiftTicks += shiftedTicks;

        return {
            skippedTurns,
            shiftedTicks,
            lastTurnTime: nextLastTurnTime.toISOString(),
            checkpoint: this.checkpoint,
        };
    }

    captureState(): InMemoryTurnWorldStateSnapshot {
        return structuredClone({
            schedule: this.schedule,
            state: this.state,
            worldConfig: this.worldConfig,
            generalPoolEntries: this.generalPoolEntries,
            checkpoint: this.checkpoint,
            generals: Array.from(this.generals.entries()),
            cities: Array.from(this.cities.entries()),
            nations: Array.from(this.nations.entries()),
            troops: Array.from(this.troops.entries()),
            diplomacy: Array.from(this.diplomacy.entries()),
            events: Array.from(this.events.entries()),
            dirtyGeneralIds: Array.from(this.dirtyGeneralIds),
            dirtyCityIds: Array.from(this.dirtyCityIds),
            dirtyNationIds: Array.from(this.dirtyNationIds),
            dirtyTroopIds: Array.from(this.dirtyTroopIds),
            dirtyDiplomacyKeys: Array.from(this.dirtyDiplomacyKeys),
            accessScoreResetGeneralIds: Array.from(this.accessScoreResetGeneralIds),
            createdGeneralIds: Array.from(this.createdGeneralIds),
            createdNationIds: Array.from(this.createdNationIds),
            createdTroopIds: Array.from(this.createdTroopIds),
            createdDiplomacyKeys: Array.from(this.createdDiplomacyKeys),
            createdEventIds: Array.from(this.createdEventIds),
            deletedTroopIds: Array.from(this.deletedTroopIds),
            deletedGeneralIds: Array.from(this.deletedGeneralIds),
            deletedNationIds: Array.from(this.deletedNationIds),
            deletedEventIds: Array.from(this.deletedEventIds),
            deletedNationSnapshots: this.deletedNationSnapshots,
            logs: this.logs,
            messages: this.messages,
            lifecycleEvents: this.lifecycleEvents,
            pendingNeutralAuctions: this.pendingNeutralAuctions,
            inheritancePointAdjustments: this.inheritancePointAdjustments,
            pendingInheritanceLogs: this.pendingInheritanceLogs,
            pendingNationBettingOpens: this.pendingNationBettingOpens,
            pendingNationBettingFinishes: this.pendingNationBettingFinishes,
            pendingYearbookSnapshots: this.pendingYearbookSnapshots,
            pendingUnificationFinalizations: this.pendingUnificationFinalizations,
            pendingRealtimeBacklogShiftTicks: this.pendingRealtimeBacklogShiftTicks,
        } satisfies InMemoryTurnWorldStateSnapshot);
    }

    restoreState(snapshot: InMemoryTurnWorldStateSnapshot): void {
        const restored = structuredClone(snapshot);
        this.schedule = restored.schedule;
        this.state = restored.state;
        for (const key of Object.keys(this.worldConfig)) {
            delete this.worldConfig[key];
        }
        Object.assign(this.worldConfig, restored.worldConfig);
        this.generalPoolEntries = restored.generalPoolEntries;
        this.checkpoint = restored.checkpoint;
        this.replaceMap(this.generals, restored.generals);
        this.replaceMap(this.cities, restored.cities);
        this.replaceMap(this.nations, restored.nations);
        this.replaceMap(this.troops, restored.troops);
        this.replaceMap(this.diplomacy, restored.diplomacy);
        this.replaceMap(this.events, restored.events);
        this.replaceSet(this.dirtyGeneralIds, restored.dirtyGeneralIds);
        this.replaceSet(this.dirtyCityIds, restored.dirtyCityIds);
        this.replaceSet(this.dirtyNationIds, restored.dirtyNationIds);
        this.replaceSet(this.dirtyTroopIds, restored.dirtyTroopIds);
        this.replaceSet(this.dirtyDiplomacyKeys, restored.dirtyDiplomacyKeys);
        this.replaceSet(this.accessScoreResetGeneralIds, restored.accessScoreResetGeneralIds ?? []);
        this.replaceSet(this.createdGeneralIds, restored.createdGeneralIds);
        this.replaceSet(this.createdNationIds, restored.createdNationIds);
        this.replaceSet(this.createdTroopIds, restored.createdTroopIds);
        this.replaceSet(this.createdDiplomacyKeys, restored.createdDiplomacyKeys);
        this.replaceSet(this.createdEventIds, restored.createdEventIds);
        this.replaceSet(this.deletedTroopIds, restored.deletedTroopIds);
        this.replaceSet(this.deletedGeneralIds, restored.deletedGeneralIds);
        this.replaceSet(this.deletedNationIds, restored.deletedNationIds);
        this.replaceSet(this.deletedEventIds, restored.deletedEventIds);
        this.replaceArray(this.deletedNationSnapshots, restored.deletedNationSnapshots);
        this.replaceArray(this.logs, restored.logs);
        this.replaceArray(this.messages, restored.messages);
        this.replaceArray(this.lifecycleEvents, restored.lifecycleEvents);
        this.replaceArray(this.pendingNeutralAuctions, restored.pendingNeutralAuctions);
        this.replaceArray(this.inheritancePointAdjustments, restored.inheritancePointAdjustments);
        this.replaceArray(this.pendingInheritanceLogs, restored.pendingInheritanceLogs ?? []);
        this.replaceArray(this.pendingNationBettingOpens, restored.pendingNationBettingOpens);
        this.replaceArray(this.pendingNationBettingFinishes, restored.pendingNationBettingFinishes);
        this.replaceArray(this.pendingYearbookSnapshots, restored.pendingYearbookSnapshots);
        this.replaceArray(this.pendingUnificationFinalizations, restored.pendingUnificationFinalizations);
        this.pendingRealtimeBacklogShiftTicks = restored.pendingRealtimeBacklogShiftTicks ?? 0;
    }

    inspectState(): InMemoryTurnWorldInspection {
        return structuredClone({
            state: this.state,
            worldConfig: this.worldConfig,
            checkpoint: this.checkpoint,
            generals: Array.from(this.generals.values()),
            cities: Array.from(this.cities.values()),
            nations: Array.from(this.nations.values()),
            troops: Array.from(this.troops.values()),
            diplomacy: Array.from(this.diplomacy.values()),
            events: Array.from(this.events.values()),
            changes: this.peekDirtyState(),
        } satisfies InMemoryTurnWorldInspection);
    }

    getState(): TurnWorldState {
        return { ...this.state };
    }

    getEntityCounts(): {
        generals: number;
        cities: number;
        nations: number;
        troops: number;
        events: number;
    } {
        return {
            generals: this.generals.size,
            cities: this.cities.size,
            nations: this.nations.size,
            troops: this.troops.size,
            events: this.events.size,
        };
    }

    updateWorldMeta(patch: Record<string, unknown>): void {
        this.state = {
            ...this.state,
            meta: {
                ...this.state.meta,
                ...patch,
            },
        };
    }

    updateWorldConfig(patch: Record<string, unknown>): void {
        Object.assign(this.worldConfig, patch);
    }

    markGeneralAccessScoreReset(generalId: number): void {
        if (Number.isSafeInteger(generalId) && generalId > 0) {
            this.accessScoreResetGeneralIds.add(generalId);
        }
    }

    changeTurnTerm(
        tickMinutes: number,
        wallNow = new Date()
    ): {
        changed: boolean;
        previousTurnTermMinutes: number;
        turnTermMinutes: number;
        previousClockBaseTime: string;
        clockBaseTime: string;
        shiftedGenerals: number;
        lastTurnTime: string;
    } {
        if (!Number.isInteger(tickMinutes) || tickMinutes <= 0) {
            throw new Error('Turn term must be a positive integer.');
        }
        const previousTickSeconds = this.state.tickSeconds;
        const nextTickSeconds = tickMinutes * 60;
        const previousClock = this.getGameClock();
        const previousClockBaseTime = previousClock.baseTime.toISOString();
        if (previousTickSeconds === nextTickSeconds) {
            this.updateWorldConfig({ turnTermMinutes: tickMinutes });
            return {
                changed: false,
                previousTurnTermMinutes: previousTickSeconds / 60,
                turnTermMinutes: tickMinutes,
                previousClockBaseTime,
                clockBaseTime: previousClockBaseTime,
                shiftedGenerals: 0,
                lastTurnTime: this.state.lastTurnTime.toISOString(),
            };
        }
        const currentWallAnchor = this.state.clockWallAnchor ?? previousClock.wallAnchor;
        const anchorWall = wallNow.getTime() < currentWallAnchor.getTime() ? currentWallAnchor : wallNow;
        const anchorTick = previousClock.nowTick(anchorWall);
        const anchorDisplay = previousClock.tickToDate(anchorTick);
        const nextBaseTime = GameClock.baseTimeForProjection(anchorDisplay, anchorTick, nextTickSeconds);
        const nextClock = new GameClock({
            baseTime: nextBaseTime,
            tick: anchorTick,
            mode: this.state.clockMode ?? 'manual',
            wallAnchor: anchorWall,
            turnSeconds: nextTickSeconds,
            phase: this.state.clockPhase ?? inferClockPhase(this.state.clockMode ?? 'manual'),
            revision: this.state.clockRevision ?? 1,
        });
        const lastTurnTick = this.state.lastTurnTick ?? previousClock.dateToTick(this.state.lastTurnTime);
        const nextLastTurnTime = nextClock.tickToDate(lastTurnTick);
        this.schedule = { entries: [{ startMinute: 0, tickMinutes }] };
        this.state = {
            ...this.state,
            tickSeconds: nextTickSeconds,
            clockBaseTime: nextBaseTime,
            clockTick: anchorTick,
            clockWallAnchor: new Date(anchorWall.getTime()),
            lastTurnTick,
            lastTurnTime: nextLastTurnTime,
            meta: {
                ...this.state.meta,
                turnterm: tickMinutes,
                lastTurnTime: nextLastTurnTime.toISOString(),
            },
        };
        this.updateWorldConfig({ turnTermMinutes: tickMinutes });
        for (const general of this.generals.values()) {
            const turnTick = general.turnTick ?? previousClock.dateToTick(general.turnTime);
            const recentWarTick =
                general.recentWarTick ??
                (general.recentWarTime ? previousClock.dateToTick(general.recentWarTime) : null);
            this.updateGeneral(general.id, {
                turnTick,
                turnTime: nextClock.tickToDate(turnTick),
                recentWarTick,
                recentWarTime: recentWarTick === null ? null : nextClock.tickToDate(recentWarTick),
            });
        }
        if (this.checkpoint) {
            const checkpointTick =
                this.checkpoint.turnTick ?? previousClock.dateToTick(new Date(this.checkpoint.turnTime));
            this.checkpoint = {
                ...this.checkpoint,
                turnTick: checkpointTick,
                turnTime: nextClock.tickToDate(checkpointTick).toISOString(),
            };
        }
        return {
            changed: true,
            previousTurnTermMinutes: previousTickSeconds / 60,
            turnTermMinutes: tickMinutes,
            previousClockBaseTime,
            clockBaseTime: nextBaseTime.toISOString(),
            shiftedGenerals: this.generals.size,
            lastTurnTime: nextLastTurnTime.toISOString(),
        };
    }

    pushLog(entry: LogEntryDraft, occurredAt?: Date): void {
        if (occurredAt && !entry.occurredAt) {
            this.logs.push({ ...entry, occurredAt: new Date(occurredAt.getTime()) });
            return;
        }
        this.logs.push(entry);
    }

    queueMessage(draft: MessageDraft): void {
        this.messages.push(draft);
    }

    queueNeutralAuction(auction: PendingNeutralAuction): void {
        this.pendingNeutralAuctions.push({
            ...auction,
            detail: { ...auction.detail },
            closeAt: new Date(auction.closeAt.getTime()),
        });
    }

    queueInheritancePointAdjustment(
        userId: string,
        key: string,
        amount: number,
        phase?: InheritancePersistencePhase
    ): void {
        if (!userId || !Number.isFinite(amount) || amount === 0) {
            return;
        }
        this.inheritancePointAdjustments.push({ userId, key, amount, ...(phase ? { phase } : {}) });
    }

    queueInheritanceLog(log: PendingInheritanceLog): void {
        if (!log.userId || !log.text) {
            return;
        }
        this.pendingInheritanceLogs.push({ ...log });
    }

    queueNationBettingOpen(betting: PendingNationBettingOpen): void {
        this.pendingNationBettingOpens.push({
            ...betting,
            candidates: betting.candidates.map((candidate) => ({
                ...candidate,
                aux: { ...candidate.aux },
            })),
        });
    }

    queueNationBettingFinish(finish: PendingNationBettingFinish): void {
        this.pendingNationBettingFinishes.push({
            ...finish,
            winnerNationIds: [...finish.winnerNationIds],
            turnTime: new Date(finish.turnTime.getTime()),
        });
    }

    queueYearbookSnapshot(snapshot: PendingYearbookSnapshot): void {
        this.pendingYearbookSnapshots.push(structuredClone(snapshot));
    }

    queueUnificationFinalization(finalization: PendingUnificationFinalization): void {
        this.pendingUnificationFinalizations.push(structuredClone(finalization));
    }

    getScenarioConfig(): ScenarioConfig {
        return this.scenarioConfig;
    }

    getWorldConfig(): Record<string, unknown> {
        return this.worldConfig;
    }

    getUnitSet(): UnitSetDefinition | undefined {
        return this.unitSet;
    }

    getGeneralById(id: number): TurnGeneral | null {
        return this.generals.get(id) ?? null;
    }

    getCityById(id: number): City | null {
        return this.cities.get(id) ?? null;
    }

    getNationById(id: number): Nation | null {
        return this.nations.get(id) ?? null;
    }

    getTroopById(id: number): Troop | null {
        return this.troops.get(id) ?? null;
    }

    listGenerals(): TurnGeneral[] {
        return Array.from(this.generals.values()).map((general) => ({
            ...general,
        }));
    }

    listGeneralPoolEntries(): TurnGeneralPoolEntry[] | undefined {
        return this.generalPoolEntries?.map((entry) => ({
            ...entry,
            reservedUntil: entry.reservedUntil ? new Date(entry.reservedUntil.getTime()) : null,
            candidate: structuredClone(entry.candidate),
        }));
    }

    replaceGeneralPoolEntries(entries: readonly TurnGeneralPoolEntry[]): void {
        this.generalPoolEntries = entries.map((entry) => ({
            ...entry,
            reservedUntil: entry.reservedUntil ? new Date(entry.reservedUntil.getTime()) : null,
            candidate: structuredClone(entry.candidate),
        }));
    }

    listGeneralPoolCandidates(
        claimedAt: Date,
        claimedAtTick = this.dateToGameTick(claimedAt)
    ): ScenarioGeneralPoolCandidate[] | undefined {
        if (!this.generalPoolEntries) {
            return undefined;
        }
        if (!Number.isSafeInteger(claimedAtTick)) {
            throw new Error(`General-pool claim tick must be a safe integer: ${claimedAtTick}`);
        }
        const claimsByEntryId = new Map<number, number>();
        const currentNames = new Set<string>();
        const prefixes: Partial<Record<number, string>> = {
            1: 'ⓝ',
            2: 'ⓝ',
            3: 'ⓜ',
            4: 'ⓖ',
            5: '㉥',
            6: 'ⓤ',
            9: 'ⓞ',
        };
        for (const general of this.generals.values()) {
            const claim = readScenarioGeneralPoolClaim(general.meta);
            if (claim) {
                claimsByEntryId.set(claim.poolEntryId, general.id);
            }
            const prefix = prefixes[general.npcState];
            currentNames.add(
                prefix && general.name.startsWith(prefix) ? general.name.slice(prefix.length) : general.name
            );
        }

        return this.generalPoolEntries
            .filter((entry) => {
                const linkedGeneralCanBeReused =
                    entry.generalId === null || this.deletedGeneralIds.has(entry.generalId);
                if (
                    !linkedGeneralCanBeReused ||
                    claimsByEntryId.has(entry.id) ||
                    currentNames.has(entry.uniqueName) ||
                    currentNames.has(entry.candidate.name)
                ) {
                    return false;
                }
                const isUnreserved =
                    entry.ownerUserId === null && entry.reservedUntil === null && entry.reservedUntilTick === null;
                // Ref compares integer GameClock ticks and keeps a reservation
                // valid at exact equality. Legacy rows without a tick fall
                // back to the projected Date column.
                const isExpired =
                    entry.reservedUntilTick !== null
                        ? entry.reservedUntilTick < claimedAtTick
                        : entry.reservedUntil !== null && entry.reservedUntil.getTime() < claimedAt.getTime();
                return isUnreserved || isExpired;
            })
            .map((entry) => structuredClone(entry.candidate));
    }

    listCities(): City[] {
        return Array.from(this.cities.values()).map((city) => ({ ...city }));
    }

    listNations(): Nation[] {
        return Array.from(this.nations.values()).map((nation) => ({
            ...nation,
        }));
    }

    listTroops(): Troop[] {
        return Array.from(this.troops.values()).map((troop) => ({
            ...troop,
        }));
    }

    listEvents(targetCode?: string): TurnEvent[] {
        return Array.from(this.events.values())
            .filter((event) => targetCode === undefined || event.targetCode.toLowerCase() === targetCode.toLowerCase())
            .sort((left, right) => right.priority - left.priority || left.id - right.id)
            .map((event) => ({ ...event, meta: { ...event.meta } }));
    }

    removeEvent(id: number): boolean {
        if (!this.events.delete(id)) {
            return false;
        }
        if (this.createdEventIds.delete(id)) {
            return true;
        }
        this.deletedEventIds.add(id);
        return true;
    }

    addEvent(event: TurnEvent): boolean {
        if (this.events.has(event.id)) {
            return false;
        }
        this.events.set(event.id, { ...event, meta: { ...event.meta } });
        this.createdEventIds.add(event.id);
        return true;
    }

    getDiplomacyEntry(srcNationId: number, destNationId: number): TurnDiplomacy | null {
        const key = buildDiplomacyKey(srcNationId, destNationId);
        let entry = this.diplomacy.get(key);
        if (!entry && srcNationId !== destNationId && this.nations.has(srcNationId) && this.nations.has(destNationId)) {
            entry = buildDefaultDiplomacy(srcNationId, destNationId);
            this.diplomacy.set(key, entry);
            this.dirtyDiplomacyKeys.add(key);
            this.createdDiplomacyKeys.add(key);
        }
        if (!entry) {
            return null;
        }
        return {
            ...entry,
            meta: { ...entry.meta },
        };
    }

    listDiplomacy(): TurnDiplomacy[] {
        this.ensureDiplomacyMatrix();
        return Array.from(this.diplomacy.values()).map((entry) => ({
            ...entry,
            meta: { ...entry.meta },
        }));
    }

    updateGeneral(id: number, patch: Partial<TurnGeneral>): TurnGeneral | null {
        const target = this.generals.get(id);
        if (!target) {
            return null;
        }
        const next = this.normalizeGeneralClock(
            applyGeneralPatch(target, {
                ...patch,
                ...(patch.turnTime && patch.turnTick === undefined ? { turnTick: undefined } : {}),
                ...(patch.recentWarTime !== undefined && patch.recentWarTick === undefined
                    ? { recentWarTick: undefined }
                    : {}),
            })
        );
        this.generals.set(id, next);
        this.dirtyGeneralIds.add(id);
        return next;
    }

    addGeneral(general: TurnGeneral): boolean {
        if (this.generals.has(general.id)) {
            return false;
        }
        const worldKillturn = resolveWorldKillturn(this.state.meta);
        const normalized = this.normalizeGeneralClock(
            normalizeGeneralTurnTime({ ...general }, this.state.lastTurnTime)
        );
        const scanOrder = this.nextLegacyGeneralScanOrder++;
        const ensured = normalizeGeneralDatabaseIntegers(
            ensureGeneralKillturn(
                { ...normalized, meta: { ...normalized.meta, legacyScanOrder: scanOrder } },
                worldKillturn
            )
        );
        this.generals.set(general.id, ensured);
        this.dirtyGeneralIds.add(general.id);
        this.createdGeneralIds.add(general.id);
        return true;
    }

    addNation(nation: Nation): boolean {
        if (this.nations.has(nation.id)) {
            return false;
        }
        this.nations.set(nation.id, { ...nation, meta: { ...nation.meta } });
        this.dirtyNationIds.add(nation.id);
        this.createdNationIds.add(nation.id);
        this.ensureDiplomacyMatrix();
        return true;
    }

    removeGeneral(id: number): boolean {
        if (!this.generals.has(id)) {
            return false;
        }
        this.generals.delete(id);
        this.dirtyGeneralIds.delete(id);
        this.createdGeneralIds.delete(id);
        this.deletedGeneralIds.add(id);
        return true;
    }

    deleteGeneralWithLifecycle(id: number, year: number, month: number): boolean {
        const general = this.generals.get(id);
        if (!general) {
            return false;
        }
        this.lifecycleEvents.push({
            generalId: id,
            outcome: 'deleted',
            before: structuredClone(general),
            isUnitedAtEvent: Math.floor(
                readMetaNumber(this.state.meta, 'isunited') ?? readMetaNumber(this.state.meta, 'isUnited') ?? 0
            ),
            year,
            month,
        });
        return this.removeGeneral(id);
    }

    updateCity(id: number, patch: Partial<City>): City | null {
        const target = this.cities.get(id);
        if (!target) {
            return null;
        }
        const next = { ...target, ...patch };
        this.cities.set(id, next);
        this.dirtyCityIds.add(id);
        return next;
    }

    updateNation(id: number, patch: Partial<Nation>): Nation | null {
        const target = this.nations.get(id);
        if (!target) {
            return null;
        }
        const next = { ...target, ...patch };
        this.nations.set(id, next);
        this.dirtyNationIds.add(id);
        return next;
    }

    updateTroop(id: number, patch: Partial<Troop>): Troop | null {
        const target = this.troops.get(id);
        if (!target) {
            return null;
        }
        const next = applyTroopPatch(target, patch);
        this.troops.set(id, next);
        this.dirtyTroopIds.add(id);
        return next;
    }

    createTroop(troop: Troop): Troop | null {
        if (this.troops.has(troop.id)) {
            return null;
        }
        const next = { ...troop };
        this.troops.set(troop.id, next);
        this.dirtyTroopIds.add(troop.id);
        this.createdTroopIds.add(troop.id);
        this.deletedTroopIds.delete(troop.id);
        return next;
    }

    removeTroop(id: number): boolean {
        if (!this.troops.has(id)) {
            return false;
        }
        this.troops.delete(id);
        this.dirtyTroopIds.delete(id);
        this.createdTroopIds.delete(id);
        this.deletedTroopIds.add(id);
        return true;
    }

    removeNation(id: number): boolean {
        if (!this.nations.has(id)) {
            return false;
        }
        this.nations.delete(id);
        this.dirtyNationIds.delete(id);
        this.createdNationIds.delete(id);
        this.deletedNationIds.add(id);
        for (const [key, entry] of this.diplomacy) {
            if (entry.fromNationId === id || entry.toNationId === id) {
                this.diplomacy.delete(key);
                this.dirtyDiplomacyKeys.delete(key);
                this.createdDiplomacyKeys.delete(key);
            }
        }
        return true;
    }

    applyDiplomacyPatch(input: { srcNationId: number; destNationId: number; patch: DiplomacyPatch }): void {
        const key = buildDiplomacyKey(input.srcNationId, input.destNationId);
        const existed = this.diplomacy.has(key);
        const base = this.diplomacy.get(key) ?? buildDefaultDiplomacy(input.srcNationId, input.destNationId);
        const next = applyDiplomacyPatchToEntry(base, input.patch);
        this.diplomacy.set(key, next);
        this.dirtyDiplomacyKeys.add(key);
        if (!existed) {
            this.createdDiplomacyKeys.add(key);
        }
    }

    setLastTurnTime(turnTime: Date): void {
        const clock = this.getGameClock();
        const requestedTick = clock.dateToTick(turnTime);
        const lastTurnTick = Math.max(this.state.lastTurnTick ?? requestedTick, requestedTick);
        const projectedTime = clock.tickToDate(lastTurnTick);
        const meta = {
            ...this.state.meta,
            lastTurnTime: projectedTime.toISOString(),
        };
        this.state = {
            ...this.state,
            lastTurnTick,
            lastTurnTime: projectedTime,
            meta,
        };
    }

    shiftSchedule(deltaMinutes: number, wallNow = new Date()): { shiftedGenerals: number; lastTurnTime: string } {
        if (!Number.isInteger(deltaMinutes) || deltaMinutes === 0) {
            throw new Error('Schedule shift must be a non-zero integer number of minutes.');
        }
        const deltaMs = deltaMinutes * 60_000;
        const shiftDate = (date: Date): Date => new Date(date.getTime() + deltaMs);
        const previousClock = this.getGameClock();
        const generalTicks = new Map(
            Array.from(this.generals.values(), (general) => [
                general.id,
                {
                    turnTick: general.turnTick ?? previousClock.dateToTick(general.turnTime),
                    recentWarTick:
                        general.recentWarTick ??
                        (general.recentWarTime ? previousClock.dateToTick(general.recentWarTime) : null),
                },
            ])
        );
        const nextBaseTime = shiftDate(previousClock.baseTime);
        const shiftedClock = new GameClock({
            baseTime: nextBaseTime,
            tick: this.state.clockTick ?? 0,
            mode: this.state.clockMode ?? 'manual',
            wallAnchor: this.state.clockWallAnchor ?? this.state.lastTurnTime,
            turnSeconds: this.state.tickSeconds,
            phase: this.state.clockPhase ?? inferClockPhase(this.state.clockMode ?? 'manual'),
            revision: this.state.clockRevision ?? 1,
        });
        const nextLastTurnTime = shiftedClock.tickToDate(this.state.lastTurnTick ?? 0);
        const nextMeta = {
            ...this.state.meta,
            lastTurnTime: nextLastTurnTime.toISOString(),
            turntime: shiftGameClockMetaDate(this.state.meta.turntime, deltaMs),
            starttime: shiftGameClockMetaDate(this.state.meta.starttime, deltaMs),
            tnmt_time: shiftGameClockMetaDate(this.state.meta.tnmt_time, deltaMs),
        };
        this.state = {
            ...this.state,
            clockBaseTime: nextBaseTime,
            // Rebasing is also the explicit resume checkpoint. Realtime mode
            // must not replay the operational downtime after an administrator
            // deliberately delays or accelerates the game schedule.
            clockWallAnchor: new Date(wallNow.getTime()),
            lastTurnTime: nextLastTurnTime,
            meta: nextMeta,
        };

        for (const general of this.generals.values()) {
            const ticks = generalTicks.get(general.id);
            if (!ticks) {
                throw new Error(`Missing captured game ticks for general ${general.id}.`);
            }
            const { turnTick, recentWarTick } = ticks;
            this.updateGeneral(general.id, {
                turnTick,
                turnTime: shiftedClock.tickToDate(turnTick),
                recentWarTick,
                recentWarTime: recentWarTick === null ? null : shiftedClock.tickToDate(recentWarTick),
            });
        }
        for (const auction of this.pendingNeutralAuctions) {
            auction.closeAt = shiftDate(auction.closeAt);
        }
        for (const entry of this.generalPoolEntries ?? []) {
            if (entry.reservedUntil) {
                entry.reservedUntil = shiftDate(entry.reservedUntil);
            }
        }
        if (this.checkpoint) {
            const checkpointTime = shiftDate(new Date(this.checkpoint.turnTime));
            this.checkpoint = {
                ...this.checkpoint,
                turnTime: checkpointTime.toISOString(),
            };
        }

        return {
            shiftedGenerals: this.generals.size,
            lastTurnTime: nextLastTurnTime.toISOString(),
        };
    }

    getNextNationId(): number {
        const meta = this.state.meta as Record<string, unknown>;
        let lastId = (meta.lastNationId as number | undefined) ?? 0;
        if (lastId === 0) {
            const currentIds = Array.from(this.nations.keys());
            lastId = currentIds.length > 0 ? Math.max(...currentIds) : 0;
        }

        const nextId = lastId + 1;
        this.state = {
            ...this.state,
            meta: {
                ...this.state.meta,
                lastNationId: nextId,
            },
        };
        return nextId;
    }

    getNextEventId(): number {
        const currentIds = Array.from(this.events.keys());
        return (currentIds.length > 0 ? Math.max(...currentIds) : 0) + 1;
    }

    getNextGeneralId(): number {
        const meta = this.state.meta as Record<string, unknown>;
        let lastId = (meta.lastGeneralId as number | undefined) ?? 0;
        const currentIds = Array.from(this.generals.keys());
        const currentMaxId = currentIds.length > 0 ? Math.max(...currentIds) : 0;
        lastId = Math.max(lastId, currentMaxId);

        const nextId = lastId + 1;
        this.state = {
            ...this.state,
            meta: {
                ...this.state.meta,
                lastGeneralId: nextId,
            },
        };
        return nextId;
    }

    setCheckpoint(checkpoint?: TurnCheckpoint): void {
        this.checkpoint = checkpoint;
    }

    getCheckpoint(): TurnCheckpoint | undefined {
        return this.checkpoint;
    }

    getNextGeneralTurnTime(checkpoint?: TurnCheckpoint): Date | null {
        let next: TurnGeneral | null = null;
        for (const general of this.generals.values()) {
            if (!shouldProcessByCheckpoint(general, checkpoint)) {
                continue;
            }
            if (!next || compareTurnOrder(general, next) < 0) {
                next = general;
            }
        }
        return next ? new Date(next.turnTime.getTime()) : null;
    }

    listDueGenerals(targetTime: Date, checkpoint?: TurnCheckpoint): TurnGeneral[] {
        const targetMs = targetTime.getTime();
        const targetTick = this.getGameClock().dateToTick(targetTime);
        const due = Array.from(this.generals.values()).filter((general) => {
            if (!shouldProcessByCheckpoint(general, checkpoint)) {
                return false;
            }
            if (general.turnTick !== undefined) {
                return general.turnTick <= targetTick;
            }
            return general.turnTime.getTime() <= targetMs;
        });
        due.sort(compareTurnOrder);
        return due;
    }

    executeGeneralTurn(general: TurnGeneral): GeneralTurnExecution {
        assertGameplayCommitAllowed(this.getGameClock().phase);
        const currentGeneral = this.generals.get(general.id) ?? general;
        const executionYear = this.state.currentYear;
        const executionMonth = this.state.currentMonth;
        const city = this.cities.get(currentGeneral.cityId);
        const nation = currentGeneral.nationId > 0 ? (this.nations.get(currentGeneral.nationId) ?? null) : null;

        const result = this.generalTurnHandler.execute({
            general: currentGeneral,
            city,
            nation,
            world: this.state,
            schedule: this.schedule,
        });

        const nextTurnAt = result.nextTurnAt ?? getNextTurnAt(currentGeneral.turnTime, this.schedule);
        if (!result.deleted?.general) {
            const resolvedGeneral = result.general ?? currentGeneral;
            const clock = this.getGameClock();
            const currentTurnTick = currentGeneral.turnTick ?? clock.dateToTick(currentGeneral.turnTime);
            const nextTurnTick =
                currentTurnTick + (clock.dateToTick(nextTurnAt) - clock.dateToTick(currentGeneral.turnTime));
            const recentWarTimeChanged =
                (resolvedGeneral.recentWarTime?.getTime() ?? null) !==
                (currentGeneral.recentWarTime?.getTime() ?? null);
            const recentWarTickChanged = resolvedGeneral.recentWarTick !== currentGeneral.recentWarTick;
            const nextGeneral = this.normalizeGeneralClock(
                normalizeGeneralDatabaseIntegers({
                    ...resolvedGeneral,
                    turnTime: nextTurnAt,
                    // Ref advances the logical tick directly. Re-encoding the
                    // millisecond Date would discard its sub-millisecond tail.
                    turnTick: nextTurnTick,
                    // A loaded row always carries recentWarTick (often null).
                    // When battle logic changes recentWarTime, discard that
                    // stale tick so normalizeGeneralClock derives the new one.
                    ...(recentWarTimeChanged && !recentWarTickChanged ? { recentWarTick: undefined } : {}),
                })
            );
            this.generals.set(nextGeneral.id, nextGeneral);
            this.dirtyGeneralIds.add(nextGeneral.id);
        }

        if (result.city) {
            this.cities.set(result.city.id, result.city);
            this.dirtyCityIds.add(result.city.id);
        }
        if (result.nation) {
            this.nations.set(result.nation.id, result.nation);
            this.dirtyNationIds.add(result.nation.id);
        }
        if (result.logs && result.logs.length > 0) {
            // Ref command logs use the executing general's pre-advance turntime.
            // Preserve that per-entry occurrence time and calendar date instead
            // of replacing them with the shared post-boundary flush context.
            for (const log of result.logs) {
                this.pushLog(
                    {
                        ...log,
                        year: log.year ?? executionYear,
                        month: log.month ?? executionMonth,
                    },
                    currentGeneral.turnTime
                );
            }
        }
        if (result.messages && result.messages.length > 0) {
            this.messages.push(...result.messages);
        }
        if (result.patches) {
            for (const patch of result.patches.generals) {
                const target = this.generals.get(patch.id);
                if (!target) {
                    continue;
                }
                const patched = applyGeneralPatch(target, {
                    ...patch.patch,
                    ...(patch.patch.turnTime && patch.patch.turnTick === undefined ? { turnTick: undefined } : {}),
                    ...(patch.patch.recentWarTime !== undefined && patch.patch.recentWarTick === undefined
                        ? { recentWarTick: undefined }
                        : {}),
                });
                this.generals.set(
                    patch.id,
                    this.normalizeGeneralClock(normalizeGeneralTurnTime(patched, this.state.lastTurnTime))
                );
                this.dirtyGeneralIds.add(patch.id);
            }
            for (const patch of result.patches.cities) {
                const target = this.cities.get(patch.id);
                if (!target) {
                    continue;
                }
                this.cities.set(patch.id, applyCityPatch(target, patch.patch));
                this.dirtyCityIds.add(patch.id);
            }
            for (const patch of result.patches.nations) {
                const target = this.nations.get(patch.id);
                if (!target) {
                    continue;
                }
                this.nations.set(patch.id, applyNationPatch(target, patch.patch));
                this.dirtyNationIds.add(patch.id);
            }
            for (const patch of result.patches.troops) {
                const target = this.troops.get(patch.id);
                if (!target) {
                    continue;
                }
                this.troops.set(patch.id, applyTroopPatch(target, patch.patch));
                this.dirtyTroopIds.add(patch.id);
            }
        }
        if (result.diplomacyPatches) {
            for (const patch of result.diplomacyPatches) {
                this.applyDiplomacyPatch({
                    srcNationId: patch.srcNationId,
                    destNationId: patch.destNationId,
                    patch: patch.patch,
                });
            }
        }
        if (result.created) {
            for (const createdGeneral of result.created.generals) {
                if (this.generals.has(createdGeneral.id)) {
                    continue;
                }
                const worldKillturn = resolveWorldKillturn(this.state.meta);
                const normalized = this.normalizeGeneralClock(
                    normalizeGeneralTurnTime({ ...createdGeneral }, this.state.lastTurnTime)
                );
                const ensured = normalizeGeneralDatabaseIntegers(ensureGeneralKillturn(normalized, worldKillturn));
                this.generals.set(createdGeneral.id, ensured);
                this.dirtyGeneralIds.add(createdGeneral.id);
                this.createdGeneralIds.add(createdGeneral.id);
            }
            if (result.created.nations) {
                let addedNation = false;
                for (const createdNation of result.created.nations) {
                    if (this.nations.has(createdNation.id)) {
                        continue;
                    }
                    this.nations.set(createdNation.id, { ...createdNation });
                    this.dirtyNationIds.add(createdNation.id);
                    this.createdNationIds.add(createdNation.id);
                    addedNation = true;
                }
                if (addedNation) {
                    this.ensureDiplomacyMatrix();
                }
            }
            if (result.created.troops) {
                for (const createdTroop of result.created.troops) {
                    if (this.troops.has(createdTroop.id)) {
                        continue;
                    }
                    this.troops.set(createdTroop.id, { ...createdTroop });
                    this.dirtyTroopIds.add(createdTroop.id);
                    this.createdTroopIds.add(createdTroop.id);
                }
            }
        }
        if (result.deleted?.troopIds) {
            for (const troopId of result.deleted.troopIds) {
                this.removeTroop(troopId);
            }
        }
        if (result.deleted?.general) {
            this.removeGeneral(currentGeneral.id);
        }
        if (result.lifecycleEvent) {
            this.lifecycleEvents.push(result.lifecycleEvent);
        }

        this.removeCollapsedNations();

        return {
            nextTurnAt,
            destroyedNationIds: (result.destroyedNationIds ?? []).filter((nationId) => !this.nations.has(nationId)),
        };
    }

    async advanceMonth(turnTime: Date): Promise<void> {
        assertGameplayCommitAllowed(this.getGameClock().phase);
        const previousYear = this.state.currentYear;
        const previousMonth = this.state.currentMonth;
        let nextYear = previousYear;
        let nextMonth = previousMonth + 1;
        if (nextMonth > 12) {
            nextMonth = 1;
            nextYear = previousYear + 1;
        }

        const context: TurnCalendarContext = {
            previousYear,
            previousMonth,
            currentYear: nextYear,
            currentMonth: nextMonth,
            turnTime,
        };
        await this.calendarHandler?.beforeMonthChanged?.(context);

        const clock = this.getGameClock();
        const requestedTick = clock.dateToTick(turnTime);
        const lastTurnTick = Math.max(this.state.lastTurnTick ?? requestedTick, requestedTick);
        const lastTurnTime = clock.tickToDate(lastTurnTick);
        const meta = {
            ...this.state.meta,
            lastTurnTime: lastTurnTime.toISOString(),
        };
        this.state = {
            ...this.state,
            currentYear: nextYear,
            currentMonth: nextMonth,
            lastTurnTick,
            lastTurnTime,
            meta,
        };

        if (this.autoAdvanceDiplomacyMonth) {
            this.advanceDiplomacyMonth();
        }
        await this.calendarHandler?.onMonthChanged?.(context);
        if (nextYear !== previousYear) {
            await this.calendarHandler?.onYearChanged?.(context);
        }
    }

    peekDirtyState(): TurnWorldChanges {
        const generals = Array.from(this.dirtyGeneralIds)
            .map((id) => this.generals.get(id))
            .filter((general): general is TurnGeneral => Boolean(general));
        const createdGenerals = Array.from(this.createdGeneralIds)
            .map((id) => this.generals.get(id))
            .filter((general): general is TurnGeneral => Boolean(general));
        const createdNations = Array.from(this.createdNationIds)
            .map((id) => this.nations.get(id))
            .filter((nation): nation is Nation => Boolean(nation));
        const cities = Array.from(this.dirtyCityIds)
            .map((id) => this.cities.get(id))
            .filter((city): city is City => Boolean(city));
        const nations = Array.from(this.dirtyNationIds)
            .map((id) => this.nations.get(id))
            .filter((nation): nation is Nation => Boolean(nation));
        const troops = Array.from(this.dirtyTroopIds)
            .map((id) => this.troops.get(id))
            .filter((troop): troop is Troop => Boolean(troop));
        const diplomacy = Array.from(this.dirtyDiplomacyKeys)
            .map((key) => this.diplomacy.get(key))
            .filter((entry): entry is TurnDiplomacy => Boolean(entry));
        const createdTroops = Array.from(this.createdTroopIds)
            .map((id) => this.troops.get(id))
            .filter((troop): troop is Troop => Boolean(troop));
        const createdDiplomacy = Array.from(this.createdDiplomacyKeys)
            .map((key) => this.diplomacy.get(key))
            .filter((entry): entry is TurnDiplomacy => Boolean(entry));
        const createdEvents = Array.from(this.createdEventIds)
            .map((id) => this.events.get(id))
            .filter((event): event is TurnEvent => Boolean(event));
        const deletedTroops = Array.from(this.deletedTroopIds);
        const deletedGenerals = Array.from(this.deletedGeneralIds);
        const deletedNations = Array.from(this.deletedNationIds);
        const deletedEvents = Array.from(this.deletedEventIds);
        const deletedNationSnapshots = this.deletedNationSnapshots.slice();
        const logs = this.logs.slice();
        const messages = this.messages.slice();
        const lifecycleEvents = this.lifecycleEvents.slice();
        const pendingNeutralAuctions = this.pendingNeutralAuctions.map((auction) => ({
            ...auction,
            detail: { ...auction.detail },
            closeAt: new Date(auction.closeAt.getTime()),
        }));
        const inheritancePointAdjustments = this.inheritancePointAdjustments.map((entry) => ({ ...entry }));
        const pendingInheritanceLogs = this.pendingInheritanceLogs.map((entry) => ({ ...entry }));
        const pendingNationBettingOpens = this.pendingNationBettingOpens.map((entry) => ({
            ...entry,
            candidates: entry.candidates.map((candidate) => ({
                ...candidate,
                aux: { ...candidate.aux },
            })),
        }));
        const pendingNationBettingFinishes = this.pendingNationBettingFinishes.map((entry) => ({
            ...entry,
            winnerNationIds: [...entry.winnerNationIds],
            turnTime: new Date(entry.turnTime.getTime()),
        }));
        const pendingYearbookSnapshots = structuredClone(this.pendingYearbookSnapshots);
        const pendingUnificationFinalizations = structuredClone(this.pendingUnificationFinalizations);
        const accessScoreResetGeneralIds = Array.from(this.accessScoreResetGeneralIds).sort(
            (left, right) => left - right
        );

        return {
            realtimeBacklogShiftTicks: this.pendingRealtimeBacklogShiftTicks,
            accessScoreResetGeneralIds,
            generals,
            cities,
            nations,
            troops,
            deletedTroops,
            deletedGenerals,
            deletedNations,
            deletedNationSnapshots,
            diplomacy,
            logs,
            messages,
            createdGenerals,
            createdNations,
            createdTroops,
            createdDiplomacy,
            createdEvents,
            deletedEvents,
            lifecycleEvents,
            pendingNeutralAuctions,
            inheritancePointAdjustments,
            pendingInheritanceLogs,
            pendingNationBettingOpens,
            pendingNationBettingFinishes,
            pendingYearbookSnapshots,
            pendingUnificationFinalizations,
        };
    }

    acknowledgeDirtyState(changes: TurnWorldChanges): void {
        this.pendingRealtimeBacklogShiftTicks = Math.max(
            0,
            this.pendingRealtimeBacklogShiftTicks - changes.realtimeBacklogShiftTicks
        );
        for (const id of changes.accessScoreResetGeneralIds) this.accessScoreResetGeneralIds.delete(id);
        for (const general of changes.generals) this.dirtyGeneralIds.delete(general.id);
        for (const city of changes.cities) this.dirtyCityIds.delete(city.id);
        for (const nation of changes.nations) this.dirtyNationIds.delete(nation.id);
        for (const troop of changes.troops) this.dirtyTroopIds.delete(troop.id);
        for (const entry of changes.diplomacy) {
            this.dirtyDiplomacyKeys.delete(buildDiplomacyKey(entry.fromNationId, entry.toNationId));
        }
        for (const general of changes.createdGenerals) this.createdGeneralIds.delete(general.id);
        for (const nation of changes.createdNations) this.createdNationIds.delete(nation.id);
        for (const troop of changes.createdTroops) this.createdTroopIds.delete(troop.id);
        for (const entry of changes.createdDiplomacy) {
            this.createdDiplomacyKeys.delete(buildDiplomacyKey(entry.fromNationId, entry.toNationId));
        }
        for (const event of changes.createdEvents) this.createdEventIds.delete(event.id);
        for (const id of changes.deletedTroops) this.deletedTroopIds.delete(id);
        for (const id of changes.deletedGenerals) this.deletedGeneralIds.delete(id);
        for (const id of changes.deletedNations) this.deletedNationIds.delete(id);
        for (const id of changes.deletedEvents) this.deletedEventIds.delete(id);
        this.deletedNationSnapshots.splice(0, changes.deletedNationSnapshots.length);
        this.logs.splice(0, changes.logs.length);
        this.messages.splice(0, changes.messages.length);
        this.lifecycleEvents.splice(0, changes.lifecycleEvents.length);
        this.pendingNeutralAuctions.splice(0, changes.pendingNeutralAuctions.length);
        this.inheritancePointAdjustments.splice(0, changes.inheritancePointAdjustments.length);
        this.pendingInheritanceLogs.splice(0, changes.pendingInheritanceLogs.length);
        this.pendingNationBettingOpens.splice(0, changes.pendingNationBettingOpens.length);
        this.pendingNationBettingFinishes.splice(0, changes.pendingNationBettingFinishes.length);
        this.pendingYearbookSnapshots.splice(0, changes.pendingYearbookSnapshots.length);
        this.pendingUnificationFinalizations.splice(0, changes.pendingUnificationFinalizations.length);
    }

    consumeDirtyState(): TurnWorldChanges {
        const changes = this.peekDirtyState();
        this.acknowledgeDirtyState(changes);
        return changes;
    }

    collapseNation(nationId: number): boolean {
        const nation = this.nations.get(nationId);
        if (!nation) {
            return false;
        }
        const generalIds = Array.from(this.generals.values())
            .filter((general) => general.nationId === nationId)
            .map((general) => general.id);

        // Legacy deleteNation() calls DeleteConflict() before removing the
        // nation. Without this, a later conquest can award a city to a
        // nation ID that no longer exists.
        for (const city of this.cities.values()) {
            const rawConflict = city.conflict;
            if (rawConflict === null || rawConflict === undefined) {
                continue;
            }
            let conflict: Record<string, unknown>;
            try {
                const parsed = typeof rawConflict === 'string' ? (JSON.parse(rawConflict) as unknown) : rawConflict;
                if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                    continue;
                }
                conflict = { ...(parsed as Record<string, unknown>) };
            } catch {
                continue;
            }
            const key = String(nationId);
            if (!Object.prototype.hasOwnProperty.call(conflict, key)) {
                continue;
            }
            delete conflict[key];
            // Ref decodes a non-empty JSON object into a PHP array. Removing
            // its last nation key and encoding that value persists `[]`, not
            // `{}`. Preserve that observable storage shape until the next
            // world load (where an empty conflict is normalized for logic).
            const persistedConflict =
                Object.keys(conflict).length === 0
                    ? ([] as unknown as City['conflict'])
                    : (conflict as City['conflict']);
            this.cities.set(city.id, {
                ...city,
                conflict: persistedConflict,
            });
            this.dirtyCityIds.add(city.id);
        }

        this.deletedNationSnapshots.push({
            nation: { ...nation },
            generalIds,
            removedAt: new Date(this.state.lastTurnTime.getTime()),
        });
        for (const general of this.generals.values()) {
            if (general.nationId !== nationId) {
                continue;
            }
            const belong = typeof general.meta.belong === 'number' ? general.meta.belong : 0;
            const maxBelong = typeof general.meta.max_belong === 'number' ? general.meta.max_belong : 0;
            const updated = applyGeneralPatch(general, {
                nationId: 0,
                officerLevel: 0,
                troopId: 0,
                meta: {
                    ...general.meta,
                    belong: 0,
                    officer_city: 0,
                    officerCity: 0,
                    permission: 'normal',
                    ...(general.npcState < 2 ? { max_belong: Math.max(belong, maxBelong) } : {}),
                },
            });
            this.generals.set(general.id, normalizeGeneralTurnTime(updated, this.state.lastTurnTime));
            this.dirtyGeneralIds.add(general.id);
        }
        for (const troop of Array.from(this.troops.values())) {
            if (troop.nationId === nationId) {
                this.removeTroop(troop.id);
            }
        }
        this.removeNation(nationId);
        return true;
    }

    private removeCollapsedNations(): void {
        const collapsedNationIds: number[] = [];
        for (const nation of this.nations.values()) {
            if (nation.id <= 0) {
                continue;
            }
            const meta = nation.meta as Record<string, unknown>;
            if (meta.collapsed !== true) {
                continue;
            }
            const cityCount = Array.from(this.cities.values()).filter((city) => city.nationId === nation.id).length;
            if (cityCount > 0) {
                continue;
            }
            collapsedNationIds.push(nation.id);
        }

        for (const nationId of collapsedNationIds) {
            this.collapseNation(nationId);
        }
    }

    private ensureDiplomacyMatrix(): void {
        const nationIds = Array.from(this.nations.keys());
        for (const srcNationId of nationIds) {
            for (const destNationId of nationIds) {
                if (srcNationId === destNationId) {
                    continue;
                }
                const key = buildDiplomacyKey(srcNationId, destNationId);
                if (this.diplomacy.has(key)) {
                    continue;
                }
                const entry = buildDefaultDiplomacy(srcNationId, destNationId);
                this.diplomacy.set(key, entry);
                this.dirtyDiplomacyKeys.add(key);
                this.createdDiplomacyKeys.add(key);
            }
        }
    }

    advanceDiplomacyMonth(generalCounts?: Map<number, number>): void {
        if (this.diplomacy.size === 0) {
            return;
        }
        const resolvedGeneralCounts = generalCounts ?? new Map<number, number>();
        if (!generalCounts) {
            for (const general of this.generals.values()) {
                const nationId = general.nationId;
                if (nationId <= 0) {
                    continue;
                }
                resolvedGeneralCounts.set(nationId, (resolvedGeneralCounts.get(nationId) ?? 0) + 1);
            }
        }

        const updated = processDiplomacyMonth(this.listDiplomacy(), resolvedGeneralCounts);
        for (const entry of updated) {
            const key = buildDiplomacyKey(entry.fromNationId, entry.toNationId);
            const prev = this.diplomacy.get(key);
            if (!prev || prev.state !== entry.state || prev.term !== entry.term || prev.dead !== entry.dead) {
                this.diplomacy.set(key, entry);
                this.dirtyDiplomacyKeys.add(key);
                if (!prev) {
                    this.createdDiplomacyKeys.add(key);
                }
            }
        }
    }

    private replaceMap<K, V>(target: Map<K, V>, entries: Array<[K, V]>): void {
        target.clear();
        for (const [key, value] of entries) {
            target.set(key, value);
        }
    }

    private replaceSet<T>(target: Set<T>, values: T[]): void {
        target.clear();
        for (const value of values) {
            target.add(value);
        }
    }

    private replaceArray<T>(target: T[], values: T[]): void {
        target.splice(0, target.length, ...values);
    }
}
