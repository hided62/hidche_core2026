import type { City, LogEntryDraft, Nation, TurnSchedule } from '@sammo-ts/logic';
import { getNextTurnAt } from '@sammo-ts/logic';

import type { TurnCheckpoint } from '../lifecycle/types.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from './types.js';

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
    };
    created?: {
        generals: TurnGeneral[];
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

const shouldProcessByCheckpoint = (
    general: TurnGeneral,
    checkpoint?: TurnCheckpoint
): boolean => {
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

const mergeStats = (
    base: TurnGeneral['stats'],
    patch: Partial<TurnGeneral['stats']>
): TurnGeneral['stats'] => ({
    leadership: patch.leadership ?? base.leadership,
    strength: patch.strength ?? base.strength,
    intelligence: patch.intelligence ?? base.intelligence,
});

const mergeRole = (
    base: TurnGeneral['role'],
    patch: Partial<TurnGeneral['role']>
): TurnGeneral['role'] => ({
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

const applyGeneralPatch = (
    base: TurnGeneral,
    patch: Partial<TurnGeneral>
): TurnGeneral => ({
    ...base,
    ...patch,
    stats: patch.stats ? mergeStats(base.stats, patch.stats) : base.stats,
    role: patch.role ? mergeRole(base.role, patch.role) : base.role,
    triggerState: patch.triggerState
        ? mergeTriggerState(base.triggerState, patch.triggerState)
        : base.triggerState,
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

export class InMemoryTurnWorld {
    // DB에서 읽어온 월드 상태를 메모리에 고정해 턴 처리를 담당한다.
    private readonly schedule: TurnSchedule;
    private readonly generalTurnHandler: GeneralTurnHandler;
    private readonly calendarHandler?: TurnCalendarHandler;
    private readonly generals = new Map<number, TurnGeneral>();
    private readonly cities = new Map<number, City>();
    private readonly nations = new Map<number, Nation>();
    private readonly dirtyGeneralIds = new Set<number>();
    private readonly dirtyCityIds = new Set<number>();
    private readonly dirtyNationIds = new Set<number>();
    private readonly createdGeneralIds = new Set<number>();
    private readonly logs: LogEntryDraft[] = [];
    private checkpoint?: TurnCheckpoint;
    private state: TurnWorldState;

    constructor(
        state: TurnWorldState,
        snapshot: TurnWorldSnapshot,
        options: InMemoryTurnWorldOptions
    ) {
        this.state = { ...state };
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
    }

    getState(): TurnWorldState {
        return { ...this.state };
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

    listDueGenerals(
        targetTime: Date,
        checkpoint?: TurnCheckpoint
    ): TurnGeneral[] {
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
        const city = this.cities.get(general.cityId);
        const nation =
            general.nationId > 0 ? this.nations.get(general.nationId) ?? null : null;

        const result = this.generalTurnHandler.execute({
            general,
            city,
            nation,
            world: this.state,
            schedule: this.schedule,
        });

        const nextTurnAt =
            result.nextTurnAt ?? getNextTurnAt(general.turnTime, this.schedule);
        const nextGeneral = {
            ...(result.general ?? general),
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
                this.generals.set(
                    patch.id,
                    applyGeneralPatch(target, patch.patch)
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
                this.nations.set(
                    patch.id,
                    applyNationPatch(target, patch.patch)
                );
                this.dirtyNationIds.add(patch.id);
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
        this.calendarHandler?.onMonthChanged?.(context);
        if (nextYear !== previousYear) {
            this.calendarHandler?.onYearChanged?.(context);
        }
    }

    consumeDirtyState(): {
        generals: TurnGeneral[];
        cities: City[];
        nations: Nation[];
        logs: LogEntryDraft[];
        createdGenerals: TurnGeneral[];
    } {
        const generals = Array.from(this.dirtyGeneralIds)
            .map((id) => this.generals.get(id))
            .filter((general): general is TurnGeneral => Boolean(general));
        const createdGenerals = Array.from(this.createdGeneralIds)
            .map((id) => this.generals.get(id))
            .filter((general): general is TurnGeneral => Boolean(general));
        const cities = Array.from(this.dirtyCityIds)
            .map((id) => this.cities.get(id))
            .filter((city): city is City => Boolean(city));
        const nations = Array.from(this.dirtyNationIds)
            .map((id) => this.nations.get(id))
            .filter((nation): nation is Nation => Boolean(nation));
        const logs = this.logs.splice(0, this.logs.length);

        this.dirtyGeneralIds.clear();
        this.dirtyCityIds.clear();
        this.dirtyNationIds.clear();
        this.createdGeneralIds.clear();

        return { generals, cities, nations, logs, createdGenerals };
    }
}
