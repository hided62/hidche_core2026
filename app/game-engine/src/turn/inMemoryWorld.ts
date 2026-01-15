import type { City, LogEntryDraft, Nation, ScenarioConfig, Troop, TurnSchedule } from '@sammo-ts/logic';
import { getNextTurnAt } from '@sammo-ts/logic';

import type { TurnCheckpoint } from '../lifecycle/types.js';
import type { TurnDiplomacy, TurnGeneral, TurnWorldSnapshot, TurnWorldState } from './types.js';
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
    // 월/연 변경에 따른 후처리를 끼워 넣기 위한 확장 포인트.
    onMonthChanged?(context: TurnCalendarContext): void;
    onYearChanged?(context: TurnCalendarContext): void;
}

export interface InMemoryTurnWorldOptions {
    schedule: TurnSchedule;
    generalTurnHandler?: GeneralTurnHandler;
    calendarHandler?: TurnCalendarHandler;
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

export class InMemoryTurnWorld {
    // DB에서 읽어온 월드 상태를 메모리에 고정해 턴 처리를 담당한다.
    private readonly schedule: TurnSchedule;
    private readonly generalTurnHandler: GeneralTurnHandler;
    private readonly calendarHandler?: TurnCalendarHandler;
    private readonly generals = new Map<number, TurnGeneral>();
    private readonly cities = new Map<number, City>();
    private readonly nations = new Map<number, Nation>();
    private readonly troops = new Map<number, Troop>();
    private readonly diplomacy = new Map<string, TurnDiplomacy>();
    private readonly dirtyGeneralIds = new Set<number>();
    private readonly dirtyCityIds = new Set<number>();
    private readonly dirtyNationIds = new Set<number>();
    private readonly dirtyTroopIds = new Set<number>();
    private readonly dirtyDiplomacyKeys = new Set<string>();
    private readonly createdGeneralIds = new Set<number>();
    private readonly createdNationIds = new Set<number>();
    private readonly createdTroopIds = new Set<number>();
    private readonly createdDiplomacyKeys = new Set<string>();
    private readonly deletedTroopIds = new Set<number>();
    private readonly deletedGeneralIds = new Set<number>();
    private readonly logs: LogEntryDraft[] = [];
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

        for (const general of snapshot.generals) {
            this.generals.set(general.id, { ...general });
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
        this.ensureDiplomacyMatrix();
    }

    getState(): TurnWorldState {
        return { ...this.state };
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

    getDiplomacyEntry(srcNationId: number, destNationId: number): TurnDiplomacy | null {
        const entry = this.diplomacy.get(buildDiplomacyKey(srcNationId, destNationId));
        if (!entry) {
            return null;
        }
        return {
            ...entry,
            meta: { ...entry.meta },
        };
    }

    listDiplomacy(): TurnDiplomacy[] {
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
        const nextGeneral = {
            ...(result.general ?? currentGeneral),
            turnTime: nextTurnAt,
        };
        this.generals.set(nextGeneral.id, nextGeneral);
        this.dirtyGeneralIds.add(nextGeneral.id);

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
        if (result.patches) {
            for (const patch of result.patches.generals) {
                const target = this.generals.get(patch.id);
                if (!target) {
                    continue;
                }
                this.generals.set(patch.id, applyGeneralPatch(target, patch.patch));
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
                this.generals.set(createdGeneral.id, { ...createdGeneral });
                this.dirtyGeneralIds.add(createdGeneral.id);
                this.createdGeneralIds.add(createdGeneral.id);
            }
            if (result.created.nations) {
                for (const createdNation of result.created.nations) {
                    if (this.nations.has(createdNation.id)) {
                        continue;
                    }
                    this.nations.set(createdNation.id, { ...createdNation });
                    this.dirtyNationIds.add(createdNation.id);
                    this.createdNationIds.add(createdNation.id);
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

        return nextTurnAt;
    }

    advanceMonth(turnTime: Date): void {
        const previousYear = this.state.currentYear;
        const previousMonth = this.state.currentMonth;
        let nextYear = previousYear;
        let nextMonth = previousMonth + 1;
        if (nextMonth > 12) {
            nextMonth = 1;
            nextYear = previousYear + 1;
        }

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

        const context: TurnCalendarContext = {
            previousYear,
            previousMonth,
            currentYear: nextYear,
            currentMonth: nextMonth,
            turnTime,
        };
        this.advanceDiplomacyMonth();
        this.calendarHandler?.onMonthChanged?.(context);
        if (nextYear !== previousYear) {
            this.calendarHandler?.onYearChanged?.(context);
        }
    }

    consumeDirtyState(): {
        generals: TurnGeneral[];
        cities: City[];
        nations: Nation[];
        troops: Troop[];
        deletedTroops: number[];
        deletedGenerals: number[];
        diplomacy: TurnDiplomacy[];
        logs: LogEntryDraft[];
        createdGenerals: TurnGeneral[];
        createdNations: Nation[];
        createdTroops: Troop[];
        createdDiplomacy: TurnDiplomacy[];
    } {
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
        const deletedTroops = Array.from(this.deletedTroopIds);
        const deletedGenerals = Array.from(this.deletedGeneralIds);
        const logs = this.logs.splice(0, this.logs.length);

        this.dirtyGeneralIds.clear();
        this.dirtyCityIds.clear();
        this.dirtyNationIds.clear();
        this.dirtyTroopIds.clear();
        this.dirtyDiplomacyKeys.clear();
        this.createdGeneralIds.clear();
        this.createdNationIds.clear();
        this.createdTroopIds.clear();
        this.createdDiplomacyKeys.clear();
        this.deletedTroopIds.clear();
        this.deletedGeneralIds.clear();

        return {
            generals,
            cities,
            nations,
            troops,
            deletedTroops,
            deletedGenerals,
            diplomacy,
            logs,
            createdGenerals,
            createdNations,
            createdTroops,
            createdDiplomacy,
        };
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
