import type {
    RunReason,
    TurnDaemonCommand,
    TurnDaemonControlQueue,
    TurnDaemonHooks,
    TurnDaemonStatus,
    TurnRunBudget,
    TurnRunResult,
    NextTickTimeResolver,
    TurnStateStore,
    TurnProcessor,
    Clock,
    TurnDaemonCommandHandler,
    TurnDaemonCommandResponder,
    TurnDaemonCommandResult,
    TurnDaemonCommandExecutionContext,
} from './types.js';
import type { EngineStateManager } from '../turn/engineStateManager.js';

type PendingRun = {
    reason: RunReason;
    targetTime?: Date;
    budget?: TurnRunBudget;
};

type TurnDaemonControlCommand = Extract<
    TurnDaemonCommand,
    { type: 'pause' | 'resume' | 'shutdown' | 'getStatus' | 'run' }
>;
type TurnDaemonMutationCommand = Exclude<TurnDaemonCommand, TurnDaemonControlCommand>;

export interface TurnDaemonLifecycleOptions {
    profile: string;
    defaultBudget: TurnRunBudget;
}

export interface TurnDaemonLifecycleDeps {
    clock: Clock;
    controlQueue: TurnDaemonControlQueue;
    getNextTickTime: NextTickTimeResolver;
    stateStore: TurnStateStore;
    processor: TurnProcessor;
    hooks?: TurnDaemonHooks;
    commandHandler?: TurnDaemonCommandHandler;
    commandResponder?: TurnDaemonCommandResponder;
    pauseGate?: () => Promise<boolean>;
    stateManager?: Pick<EngineStateManager, 'transaction'>;
}

export class TurnDaemonLifecycle {
    // 턴 데몬의 생명주기를 관리하는 루프.
    private readonly clock: Clock;
    private readonly controlQueue: TurnDaemonControlQueue;
    private readonly getNextTickTime: NextTickTimeResolver;
    private readonly stateStore: TurnStateStore;
    private readonly processor: TurnProcessor;
    private readonly hooks?: TurnDaemonHooks;
    private readonly commandHandler?: TurnDaemonCommandHandler;
    private readonly commandResponder?: TurnDaemonCommandResponder;
    private readonly pauseGate?: () => Promise<boolean>;
    private readonly stateManager?: Pick<EngineStateManager, 'transaction'>;
    private readonly options: TurnDaemonLifecycleOptions;

    private status: TurnDaemonStatus;
    private pendingRun: PendingRun | null = null;
    private stopping = false;
    private loopPromise: Promise<void> | null = null;
    private manualPaused = false;
    private errorPaused = false;

    constructor(deps: TurnDaemonLifecycleDeps, options: TurnDaemonLifecycleOptions) {
        this.clock = deps.clock;
        this.controlQueue = deps.controlQueue;
        this.getNextTickTime = deps.getNextTickTime;
        this.stateStore = deps.stateStore;
        this.processor = deps.processor;
        this.hooks = deps.hooks;
        this.commandHandler = deps.commandHandler;
        this.commandResponder = deps.commandResponder;
        this.pauseGate = deps.pauseGate;
        this.stateManager = deps.stateManager;
        this.options = options;
        this.status = {
            state: 'idle',
            running: false,
            paused: false,
            queueDepth: 0,
        };
    }

    start(): Promise<void> {
        if (!this.loopPromise) {
            this.loopPromise = this.runLoop();
        }
        return this.loopPromise;
    }

    async stop(reason?: string): Promise<void> {
        this.controlQueue.enqueue({ type: 'shutdown', reason });
        if (this.loopPromise) {
            await this.loopPromise;
        }
    }

    requestRun(reason: RunReason, targetTime?: Date, budget?: TurnRunBudget): void {
        this.controlQueue.enqueue({
            type: 'run',
            reason,
            targetTime: targetTime ? targetTime.toISOString() : undefined,
            budget,
        });
    }

    pause(reason?: string): void {
        this.controlQueue.enqueue({ type: 'pause', reason });
    }

    resume(reason?: string): void {
        this.controlQueue.enqueue({ type: 'resume', reason });
    }

    getStatus(): TurnDaemonStatus {
        return {
            ...this.status,
            queueDepth: this.controlQueue.getDepth(),
        };
    }

    private async runLoop(): Promise<void> {
        await this.initializeState();
        while (!this.stopping) {
            await this.drainCommands();
            if (this.stopping) {
                break;
            }
            const gatePaused = (await this.pauseGate?.()) ?? false;
            if (this.errorPaused && !gatePaused) {
                this.errorPaused = false;
                this.status.lastError = undefined;
            }
            this.status.paused = this.manualPaused || gatePaused || this.errorPaused;
            if (this.status.paused) {
                this.status.state = 'paused';
                if (this.manualPaused) {
                    await this.waitForResume();
                } else {
                    await this.clock.sleepMs(500);
                }
                continue;
            }
            if (this.status.state === 'paused') {
                this.status.state = 'idle';
            }

            if ((await this.stateStore.shouldHaltScheduledRuns?.()) ?? false) {
                this.status.nextTurnTime = undefined;
                await this.clock.sleepMs(500);
                continue;
            }

            if (this.pendingRun) {
                await this.runOnce(this.pendingRun);
                this.pendingRun = null;
                continue;
            }

            const nextRunTime = await this.resolveNextRunTime();
            if (!nextRunTime) {
                await this.clock.sleepMs(200);
                continue;
            }

            const nowMs = this.clock.nowMs();
            const gameClock = await this.stateStore.loadGameClock?.(new Date(nowMs));
            if (gameClock?.mode === 'manual') {
                // Ref observes all generals due before one monthly boundary in
                // a single snapshot. Manual mode advances directly to that
                // boundary instead of letting sub-minute general timestamps
                // alter command/RNG order. After a restart, drain only turns
                // strictly older than the persisted game time before moving on.
                const gameNowMs = gameClock.now.getTime();
                const hasOverdueGeneral = nextRunTime.getTime() < gameNowMs;
                const targetTime = hasOverdueGeneral
                    ? new Date(gameNowMs - 1)
                    : this.getNextTickTime(new Date(this.status.lastTurnTime!));
                await this.runOnce({ reason: 'schedule', targetTime });
                continue;
            }
            const gameNowMs = gameClock?.now.getTime() ?? nowMs;
            const nextTurnMs = nextRunTime.getTime();
            if (gameNowMs >= nextTurnMs) {
                // Preserve Ref's chronological boundary even when realtime has
                // fallen multiple months behind. Draining every general through
                // gameNow before advancing the first pending month labels and
                // resolves all of those future commands in the stale month and
                // can build an unbounded same-month catch-up backlog. Within the current
                // month we still observe every due general through gameNow; once
                // a month boundary is overdue, process only through that boundary.
                const nextMonthMs = this.getNextTickTime(new Date(this.status.lastTurnTime!)).getTime();
                await this.runOnce({ reason: 'schedule', targetTime: new Date(Math.min(gameNowMs, nextMonthMs)) });
                continue;
            }

            const command = await this.controlQueue.waitUntil(nowMs + (nextTurnMs - gameNowMs));
            if (command) {
                await this.handleCommand(command);
            }
        }
    }

    private async initializeState(): Promise<void> {
        const lastTurnTime = await this.stateStore.loadLastTurnTime();
        const checkpoint = await this.stateStore.loadCheckpoint();
        this.status.lastTurnTime = lastTurnTime.toISOString();
        this.status.checkpoint = checkpoint;
        await this.resolveNextRunTime();
    }

    private async resolveNextRunTime(): Promise<Date | null> {
        if (!this.status.lastTurnTime) {
            this.status.nextTurnTime = undefined;
            return null;
        }

        const lastTurnTime = new Date(this.status.lastTurnTime);
        const nextGeneralTurnTime = await this.stateStore.loadNextGeneralTurnTime();
        const nextTickTime = this.getNextTickTime(lastTurnTime);
        // 같은 시각이면 Ref처럼 월 경계를 먼저 처리한다. 해당 장수는 월
        // 처리 직후 다음 daemon pass에서 과거 due turn으로 실행된다.
        const nextTurnTime =
            nextGeneralTurnTime && nextGeneralTurnTime.getTime() < nextTickTime.getTime()
                ? nextGeneralTurnTime
                : nextTickTime;

        this.status.nextTurnTime = nextTurnTime.toISOString();
        return nextTurnTime;
    }

    private async drainCommands(): Promise<void> {
        const commands = await this.controlQueue.drain();
        for (const command of commands) {
            await this.handleCommand(command);
            if (this.stopping) {
                return;
            }
        }
    }

    private async waitForResume(): Promise<void> {
        const command = await this.controlQueue.waitUntil(null);
        if (command) {
            await this.handleCommand(command);
        }
    }

    private async handleCommand(command: TurnDaemonCommand): Promise<void> {
        switch (command.type) {
            case 'pause':
                this.manualPaused = true;
                this.status.paused = true;
                this.status.state = 'paused';
                if (command.requestId) {
                    await this.commandResponder?.publishStatus(command.requestId, this.getStatus());
                }
                return;
            case 'resume':
                this.manualPaused = false;
                this.status.paused = this.errorPaused;
                this.status.state = 'idle';
                if (command.requestId) {
                    await this.commandResponder?.publishStatus(command.requestId, this.getStatus());
                }
                return;
            case 'shutdown':
                this.status.state = 'stopping';
                this.stopping = true;
                if (command.requestId) {
                    await this.commandResponder?.publishStatus(command.requestId, this.getStatus());
                }
                return;
            case 'getStatus': {
                if (command.requestId) {
                    await this.commandResponder?.publishStatus(command.requestId, this.getStatus());
                }
                return;
            }
            case 'run':
                this.pendingRun = {
                    reason: command.reason,
                    targetTime: command.targetTime ? new Date(command.targetTime) : undefined,
                    budget: command.budget,
                };
                this.status.pendingReason = command.reason;
                if (command.requestId) {
                    await this.commandResponder?.publishStatus(command.requestId, this.getStatus());
                }
                return;
            default:
                await this.handleMutationCommand(command);
                return;
        }
    }

    private async handleMutationCommand(command: TurnDaemonMutationCommand): Promise<void> {
        let result: TurnDaemonCommandResult;
        let committedByExecutionBoundary = false;
        const executeHandler = async (
            context?: TurnDaemonCommandExecutionContext
        ): Promise<TurnDaemonCommandResult> => {
            const handled = this.commandHandler ? await this.commandHandler.handle(command, context) : null;
            return (
                handled ?? {
                    type: 'commandRejected',
                    ok: false,
                    commandType: command.type,
                    reason: '턴 데몬이 명령을 처리할 수 없습니다.',
                }
            );
        };
        try {
            const executeAndCommit = async (): Promise<TurnDaemonCommandResult> => {
                let nextResult: TurnDaemonCommandResult;
                if (command.requestId && this.hooks?.executeCommand) {
                    nextResult = await this.hooks.executeCommand(command.requestId, executeHandler);
                    committedByExecutionBoundary = true;
                } else {
                    nextResult = await executeHandler();
                }
                if (!committedByExecutionBoundary && command.requestId && this.hooks?.commitCommand) {
                    await this.hooks.commitCommand(command.requestId, nextResult);
                }
                return nextResult;
            };
            result = this.stateManager
                ? await this.stateManager.transaction(executeAndCommit)
                : await executeAndCommit();
        } catch (error) {
            // The state-manager boundary includes the durable command commit, so a
            // database/fencing failure restores every in-memory mutation as well.
            this.status.state = 'paused';
            this.status.paused = true;
            this.errorPaused = true;
            this.status.lastError = error instanceof Error ? error.message : 'Unknown command error.';
            if (command.requestId && this.commandResponder?.publishCommandError) {
                try {
                    await this.commandResponder.publishCommandError(command.requestId, error);
                } catch (reportError) {
                    const reportMessage =
                        reportError instanceof Error ? reportError.message : 'Unknown command failure reporting error.';
                    this.status.lastError = `${this.status.lastError} (failure report: ${reportMessage})`;
                }
            }
            await this.hooks?.onRunError?.(error);
            return;
        }

        if ((result.type === 'shiftSchedule' || result.type === 'updateRuntimeSettings') && result.ok) {
            this.status.lastTurnTime = result.lastTurnTime;
            this.status.checkpoint = result.checkpoint;
            await this.stateStore.saveCheckpoint(result.checkpoint);
            await this.resolveNextRunTime();
        }

        try {
            await this.hooks?.publishCommandEvents?.(result);
        } catch (error) {
            // The command is already durable. Realtime publication is a
            // best-effort read-model invalidation and must not reject it.
            this.status.lastError = error instanceof Error ? error.message : 'Unknown command event publication error.';
        }

        if (this.commandResponder && command.requestId) {
            await this.commandResponder.publishCommandResult(command.requestId, result);
        }
    }

    private async runOnce(pending: PendingRun): Promise<void> {
        const startMs = this.clock.nowMs();
        this.status.state = 'running';
        this.status.running = true;
        this.status.pendingReason = pending.reason;

        const targetTime = pending.targetTime ?? new Date(startMs);
        const budget = pending.budget ?? this.options.defaultBudget;
        const checkpoint = this.status.checkpoint;
        let result: TurnRunResult;
        let fallbackError = 'Unknown turn daemon error.';

        try {
            const runAndFlush = async (): Promise<TurnRunResult> => {
                await this.stateStore.advanceGameClockTo?.(targetTime, new Date(startMs));
                const nextResult = await this.processor.run(targetTime, budget, checkpoint);
                fallbackError = 'Unknown turn flush error.';
                this.status.state = 'flushing';
                await this.stateStore.saveLastTurnTime(new Date(nextResult.lastTurnTime));
                await this.stateStore.saveCheckpoint(nextResult.checkpoint);
                await this.hooks?.flushChanges?.(nextResult);
                return nextResult;
            };
            result = this.stateManager ? await this.stateManager.transaction(runAndFlush) : await runAndFlush();
        } catch (error) {
            this.status.running = false;
            this.status.state = 'paused';
            this.status.paused = true;
            this.errorPaused = true;
            this.status.lastError = error instanceof Error ? error.message : fallbackError;
            await this.hooks?.onRunError?.(error);
            return;
        } finally {
            this.status.running = false;
        }

        await this.applyRunResult(result, startMs);
        this.status.state = 'idle';
        try {
            await this.hooks?.publishEvents?.(result);
        } catch (error) {
            this.status.lastError = error instanceof Error ? error.message : 'Unknown event publication error.';
        }
    }

    private async applyRunResult(result: TurnRunResult, startMs: number): Promise<void> {
        this.status.lastRunAt = new Date(startMs).toISOString();
        this.status.lastDurationMs = Math.max(0, this.clock.nowMs() - startMs);
        this.status.lastTurnTime = result.lastTurnTime;
        this.status.checkpoint = result.checkpoint;
        await this.resolveNextRunTime();
    }
}
