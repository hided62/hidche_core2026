import { performance } from 'node:perf_hooks';

import type { TurnCheckpoint, TurnProcessor, TurnRunBudget, TurnRunResult } from '../lifecycle/types.js';
import { getNextTickTime } from '../lifecycle/getNextTickTime.js';
import type { InMemoryTurnWorld, TurnCalendarContext } from './inMemoryWorld.js';
import type { TurnGeneral } from './types.js';
import { asNumber, asRecord, calculateAccessRefreshLimit } from '@sammo-ts/common';

export interface InMemoryTurnProcessorOptions {
    tickMinutes?: number;
    beforeExecuteGeneral?: (general: TurnGeneral) => Promise<void>;
    afterExecuteGeneral?: (general: TurnGeneral, result: TurnGeneralExecutionResult) => Promise<void>;
    dispatchScenarioEvent?: (targetCode: string, context: TurnCalendarContext) => Promise<void>;
}

export type TurnGeneralExecutionResult = {
    ok: boolean;
    executedAt: Date;
    nextTurnAt?: Date;
    error?: unknown;
};

const resolveTickMinutes = (world: InMemoryTurnWorld, override?: number): number => {
    if (override !== undefined) {
        return Math.max(1, override);
    }
    const tickSeconds = world.getState().tickSeconds;
    return Math.max(1, Math.round(tickSeconds / 60));
};

const isWorldUnited = (world: InMemoryTurnWorld): boolean => {
    const meta = asRecord(world.getState().meta);
    // Ref keeps the event game running at isunited=1. Only the post-unification
    // choice wait (2) and the completed invader game (3) stop month progress.
    return asNumber(meta.isunited ?? meta.isUnited, 0) >= 2;
};

export class InMemoryTurnProcessor implements TurnProcessor {
    // 인메모리 월드로 턴을 실행하고 월/연 갱신까지 처리한다.
    private readonly world: InMemoryTurnWorld;
    private readonly tickMinutesOverride?: number;
    private readonly beforeExecuteGeneral?: (general: TurnGeneral) => Promise<void>;
    private readonly afterExecuteGeneral?: (general: TurnGeneral, result: TurnGeneralExecutionResult) => Promise<void>;
    private readonly dispatchScenarioEvent?: (targetCode: string, context: TurnCalendarContext) => Promise<void>;

    constructor(world: InMemoryTurnWorld, options: InMemoryTurnProcessorOptions = {}) {
        this.world = world;
        this.tickMinutesOverride = options.tickMinutes;
        this.beforeExecuteGeneral = options.beforeExecuteGeneral;
        this.afterExecuteGeneral = options.afterExecuteGeneral;
        this.dispatchScenarioEvent = options.dispatchScenarioEvent;
    }

    async run(targetTime: Date, budget: TurnRunBudget, checkpoint?: TurnCheckpoint): Promise<TurnRunResult> {
        const startMs = performance.now();
        const deadlineMs = startMs + Math.max(0, budget.budgetMs);
        const isBudgetExpired = () => performance.now() >= deadlineMs;

        if (isWorldUnited(this.world)) {
            return {
                lastTurnTime: this.world.getState().lastTurnTime.toISOString(),
                processedGenerals: 0,
                processedTurns: 0,
                durationMs: Math.max(0, performance.now() - startMs),
                partial: false,
                checkpoint,
            };
        }

        this.world.setCheckpoint(checkpoint);
        this.world.updateWorldMeta({
            refreshLimit: calculateAccessRefreshLimit(this.world.getState().tickSeconds),
        });
        const tickMinutes = resolveTickMinutes(this.world, this.tickMinutesOverride);

        let processedGenerals = 0;
        let processedTurns = 0;
        let partial = false;
        let generalPartial = false;
        let nextCheckpoint: TurnCheckpoint | undefined = undefined;

        const previousLastTurnTime = this.world.getState().lastTurnTime;
        const firstTickTime = getNextTickTime(previousLastTurnTime, tickMinutes);
        // Ref processes `turntime < monthlyBoundary` before the monthly turn. A
        // general exactly on the boundary therefore runs only after that month
        // has advanced, on the daemon's following pass.
        // The monthly boundary itself stays strict (`turn_time < boundary`) like
        // Ref. A manual clock may instead target an overdue general whose time
        // is older than lastTurnTime; that exact general must be included or the
        // daemon would repeatedly flush an empty run without advancing.
        const useStrictGeneralCutoff = firstTickTime.getTime() === targetTime.getTime();
        const generalCutoff = useStrictGeneralCutoff ? new Date(targetTime.getTime() - 1) : targetTime;
        const dueGenerals = this.world.listDueGenerals(generalCutoff, checkpoint);
        for (const general of dueGenerals) {
            if (processedGenerals >= budget.maxGenerals || isBudgetExpired()) {
                partial = true;
                generalPartial = true;
                break;
            }
            const executedAt = new Date(general.turnTime.getTime());
            if (this.beforeExecuteGeneral) {
                await this.beforeExecuteGeneral(general);
            }
            let nextTurnAt: Date | undefined;
            let executionError: unknown;
            try {
                const execution = this.world.executeGeneralTurn(general);
                nextTurnAt = execution.nextTurnAt;
                if (execution.destroyedNationIds.length > 0 && this.dispatchScenarioEvent) {
                    const state = this.world.getState();
                    const eventContext: TurnCalendarContext = {
                        previousYear: state.currentYear,
                        previousMonth: state.currentMonth,
                        currentYear: state.currentYear,
                        currentMonth: state.currentMonth,
                        turnTime: new Date(state.lastTurnTime.getTime()),
                        legacyTurnTime: new Date(state.lastTurnTime.getTime()),
                    };
                    for (const _nationId of execution.destroyedNationIds) {
                        await this.dispatchScenarioEvent('destroy_nation', eventContext);
                    }
                }
            } catch (error) {
                executionError = error;
            }
            if (this.afterExecuteGeneral) {
                await this.afterExecuteGeneral(general, {
                    ok: executionError === undefined,
                    executedAt,
                    nextTurnAt,
                    error: executionError,
                });
            }
            if (executionError !== undefined) {
                throw executionError;
            }
            // Ref의 updateTurnTime()은 장수 명령이 성공한 뒤 그 장수의
            // 순간 벌점을 같은 턴 flush에서 초기화한다.
            this.world.markGeneralAccessScoreReset(general.id);
            processedGenerals += 1;
            nextCheckpoint = {
                turnTime: executedAt.toISOString(),
                turnTick: general.turnTick,
                generalId: general.id,
                year: this.world.getState().currentYear,
                month: this.world.getState().currentMonth,
            };
        }

        if (!partial) {
            let nextTickTime = getNextTickTime(this.world.getState().lastTurnTime, tickMinutes);
            while (!isWorldUnited(this.world) && nextTickTime.getTime() <= targetTime.getTime()) {
                if (processedTurns >= budget.catchUpCap || isBudgetExpired()) {
                    partial = true;
                    break;
                }
                await this.world.advanceMonth(nextTickTime);
                processedTurns += 1;
                if (isWorldUnited(this.world)) {
                    break;
                }
                nextTickTime = getNextTickTime(this.world.getState().lastTurnTime, tickMinutes);
            }
        }

        if (!generalPartial) {
            nextCheckpoint = undefined;
        }

        const lastTurnTime = this.world.getState().lastTurnTime.toISOString();

        return {
            lastTurnTime,
            processedGenerals,
            processedTurns,
            durationMs: Math.max(0, performance.now() - startMs),
            partial,
            checkpoint: nextCheckpoint,
        };
    }
}
