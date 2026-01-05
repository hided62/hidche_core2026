import type { TurnCheckpoint, TurnProcessor, TurnRunBudget, TurnRunResult } from '../lifecycle/types.js';
import { getNextTickTime } from '../lifecycle/getNextTickTime.js';
import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import type { TurnGeneral } from './types.js';

export interface InMemoryTurnProcessorOptions {
    tickMinutes?: number;
    beforeExecuteGeneral?: (general: TurnGeneral) => Promise<void>;
}

const resolveTickMinutes = (world: InMemoryTurnWorld, override?: number): number => {
    if (override !== undefined) {
        return Math.max(1, override);
    }
    const tickSeconds = world.getState().tickSeconds;
    return Math.max(1, Math.round(tickSeconds / 60));
};

export class InMemoryTurnProcessor implements TurnProcessor {
    // 인메모리 월드로 턴을 실행하고 월/연 갱신까지 처리한다.
    private readonly world: InMemoryTurnWorld;
    private readonly tickMinutes: number;
    private readonly beforeExecuteGeneral?: (general: TurnGeneral) => Promise<void>;

    constructor(world: InMemoryTurnWorld, options: InMemoryTurnProcessorOptions = {}) {
        this.world = world;
        this.tickMinutes = resolveTickMinutes(world, options.tickMinutes);
        this.beforeExecuteGeneral = options.beforeExecuteGeneral;
    }

    async run(targetTime: Date, budget: TurnRunBudget, checkpoint?: TurnCheckpoint): Promise<TurnRunResult> {
        const startMs = Date.now();
        const deadlineMs = startMs + Math.max(0, budget.budgetMs);
        const isBudgetExpired = () => Date.now() >= deadlineMs;

        this.world.setCheckpoint(checkpoint);

        let processedGenerals = 0;
        let processedTurns = 0;
        let partial = false;
        let generalPartial = false;
        let nextCheckpoint: TurnCheckpoint | undefined = undefined;

        const dueGenerals = this.world.listDueGenerals(targetTime, checkpoint);
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
            this.world.executeGeneralTurn(general);
            processedGenerals += 1;
            nextCheckpoint = {
                turnTime: executedAt.toISOString(),
                generalId: general.id,
                year: this.world.getState().currentYear,
                month: this.world.getState().currentMonth,
            };
        }

        if (!partial) {
            let nextTickTime = getNextTickTime(this.world.getState().lastTurnTime, this.tickMinutes);
            while (nextTickTime.getTime() <= targetTime.getTime()) {
                if (processedTurns >= budget.catchUpCap || isBudgetExpired()) {
                    partial = true;
                    break;
                }
                this.world.advanceMonth(nextTickTime);
                processedTurns += 1;
                nextTickTime = getNextTickTime(this.world.getState().lastTurnTime, this.tickMinutes);
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
            durationMs: Math.max(0, Date.now() - startMs),
            partial,
            checkpoint: nextCheckpoint,
        };
    }
}
