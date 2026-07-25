import type { City, LogEntryDraft, MessageDraft, Nation, ScenarioConfig, Troop, TurnSchedule } from '@sammo-ts/logic';
import { getNextTurnAt } from '@sammo-ts/logic';

import type { TurnCheckpoint } from '../lifecycle/types.js';
import type {
    PendingNeutralAuction,
    TurnDiplomacy,
    TurnEvent,
    TurnGeneral,
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
    lifecycleEvent?: GeneralLifecycleEvent;
}

export interface GeneralLifecycleEvent {
    generalId: number;
    outcome: 'active' | 'detached' | 'deleted' | 'retired';
    before: TurnGeneral;
    after?: TurnGeneral;
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
}

export interface TurnWorldChanges {
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
    inheritancePointAdjustments: Array<{ userId: string; key: string; amount: number }>;
}

const compareTurnOrder = (left: TurnGeneral, right: TurnGeneral): number => {
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
    private readonly createdGeneralIds = new Set<number>();
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
    private readonly inheritancePointAdjustments: Array<{ userId: string; key: string; amount: number }> = [];
    private readonly scenarioConfig: ScenarioConfig;
    private checkpoint?: TurnCheckpoint;
    private state: TurnWorldState;

    constructor(state: TurnWorldState, snapshot: TurnWorldSnapshot, options: InMemoryTurnWorldOptions) {
        this.state = { ...state };
        this.scenarioConfig = snapshot.scenarioConfig;
        this.schedule = options.schedule;
        this.generalTurnHandler =
            options.generalTurnHandler ??
            ({
                execute: () => ({}),
            } satisfies GeneralTurnHandler);
        this.calendarHandler = options.calendarHandler;

        const worldKillturn = resolveWorldKillturn(this.state.meta);
        for (const general of snapshot.generals) {
            const normalized = normalizeGeneralTurnTime({ ...general }, this.state.lastTurnTime);
            const ensured = ensureGeneralKillturn(normalized, worldKillturn);
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

    getState(): TurnWorldState {
        return { ...this.state };
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

    changeTurnTerm(tickMinutes: number): void {
        if (!Number.isInteger(tickMinutes) || tickMinutes <= 0) {
            throw new Error('Turn term must be a positive integer.');
        }
        const previousTickSeconds = this.state.tickSeconds;
        const nextTickSeconds = tickMinutes * 60;
        if (previousTickSeconds === nextTickSeconds) {
            return;
        }
        const ratio = nextTickSeconds / previousTickSeconds;
        const baseTime = this.state.lastTurnTime.getTime();
        for (const general of this.generals.values()) {
            const nextTurnTime = new Date(baseTime + (general.turnTime.getTime() - baseTime) * ratio);
            this.updateGeneral(general.id, { turnTime: nextTurnTime });
        }
        this.schedule = { entries: [{ startMinute: 0, tickMinutes }] };
        this.state = {
            ...this.state,
            tickSeconds: nextTickSeconds,
        };
    }

    pushLog(entry: LogEntryDraft): void {
        this.logs.push(entry);
    }

    queueNeutralAuction(auction: PendingNeutralAuction): void {
        this.pendingNeutralAuctions.push({
            ...auction,
            detail: { ...auction.detail },
            closeAt: new Date(auction.closeAt.getTime()),
        });
    }

    queueInheritancePointAdjustment(userId: string, key: string, amount: number): void {
        if (!userId || !Number.isFinite(amount) || amount === 0) {
            return;
        }
        this.inheritancePointAdjustments.push({ userId, key, amount });
    }

    getScenarioConfig(): ScenarioConfig {
        return this.scenarioConfig;
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
        if (srcNationId === destNationId) {
            return null;
        }
        const key = buildDiplomacyKey(srcNationId, destNationId);
        let entry = this.diplomacy.get(key);
        if (!entry && this.nations.has(srcNationId) && this.nations.has(destNationId)) {
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
        const next = applyGeneralPatch(target, patch);
        this.generals.set(id, next);
        this.dirtyGeneralIds.add(id);
        return next;
    }

    addGeneral(general: TurnGeneral): boolean {
        if (this.generals.has(general.id)) {
            return false;
        }
        const worldKillturn = resolveWorldKillturn(this.state.meta);
        const normalized = normalizeGeneralTurnTime({ ...general }, this.state.lastTurnTime);
        const ensured = ensureGeneralKillturn(normalized, worldKillturn);
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
        const meta = {
            ...this.state.meta,
            lastTurnTime: turnTime.toISOString(),
        };
        this.state = {
            ...this.state,
            lastTurnTime: new Date(turnTime.getTime()),
            meta,
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
        if (lastId === 0) {
            const currentIds = Array.from(this.generals.keys());
            lastId = currentIds.length > 0 ? Math.max(...currentIds) : 0;
        }

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
        const due = Array.from(this.generals.values()).filter((general) => {
            if (!shouldProcessByCheckpoint(general, checkpoint)) {
                return false;
            }
            return general.turnTime.getTime() <= targetMs;
        });
        due.sort(compareTurnOrder);
        return due;
    }

    executeGeneralTurn(general: TurnGeneral): Date {
        const currentGeneral = this.generals.get(general.id) ?? general;
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
            const nextGeneral = {
                ...(result.general ?? currentGeneral),
                turnTime: nextTurnAt,
            };
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
            this.logs.push(...result.logs);
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
                const patched = applyGeneralPatch(target, patch.patch);
                this.generals.set(patch.id, normalizeGeneralTurnTime(patched, this.state.lastTurnTime));
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
                const normalized = normalizeGeneralTurnTime({ ...createdGeneral }, this.state.lastTurnTime);
                const ensured = ensureGeneralKillturn(normalized, worldKillturn);
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

        return nextTurnAt;
    }

    async advanceMonth(turnTime: Date): Promise<void> {
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

        const meta = {
            ...this.state.meta,
            lastTurnTime: turnTime.toISOString(),
        };
        this.state = {
            ...this.state,
            currentYear: nextYear,
            currentMonth: nextMonth,
            lastTurnTime: new Date(turnTime.getTime()),
            meta,
        };

        this.advanceDiplomacyMonth();
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

        return {
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
        };
    }

    acknowledgeDirtyState(changes: TurnWorldChanges): void {
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
    }

    consumeDirtyState(): TurnWorldChanges {
        const changes = this.peekDirtyState();
        this.acknowledgeDirtyState(changes);
        return changes;
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
            // Legacy deleteNation() calls DeleteConflict() before removing the
            // nation. Without this, a later conquest can award a city to a
            // nation ID that no longer exists.
            for (const city of this.cities.values()) {
                const rawConflict = city.meta.conflict;
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
                this.cities.set(city.id, {
                    ...city,
                    meta: {
                        ...city.meta,
                        conflict: JSON.stringify(conflict),
                    },
                });
                this.dirtyCityIds.add(city.id);
            }

            const nation = this.nations.get(nationId);
            if (nation) {
                const generalIds = Array.from(this.generals.values())
                    .filter((general) => general.nationId === nationId)
                    .map((general) => general.id);
                this.deletedNationSnapshots.push({
                    nation: { ...nation },
                    generalIds,
                    removedAt: new Date(this.state.lastTurnTime.getTime()),
                });
            }
            for (const general of this.generals.values()) {
                if (general.nationId !== nationId) {
                    continue;
                }
                const updated = applyGeneralPatch(general, {
                    nationId: 0,
                    officerLevel: 0,
                    troopId: 0,
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

    private advanceDiplomacyMonth(): void {
        if (this.diplomacy.size === 0) {
            return;
        }
        const generalCounts = new Map<number, number>();
        for (const general of this.generals.values()) {
            const nationId = general.nationId;
            if (nationId <= 0) {
                continue;
            }
            generalCounts.set(nationId, (generalCounts.get(nationId) ?? 0) + 1);
        }

        const updated = processDiplomacyMonth(this.listDiplomacy(), generalCounts);
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
}
