import type {
    RunReason,
    TurnDaemonCommand,
    TurnDaemonControlQueue,
    TurnDaemonHooks,
    TurnDaemonStatus,
    TurnRunBudget,
    TurnRunResult,
    TurnSchedule,
    TurnStateStore,
    TurnProcessor,
    Clock,
    TurnCheckpoint,
} from './types.js';

type PendingRun = {
    reason: RunReason;
    targetTime?: Date;
    budget?: TurnRunBudget;
};

export interface TurnDaemonLifecycleOptions {
    profile: string;
    defaultBudget: TurnRunBudget;
}

export interface TurnDaemonLifecycleDeps {
    clock: Clock;
    controlQueue: TurnDaemonControlQueue;
    schedule: TurnSchedule;
    stateStore: TurnStateStore;
    processor: TurnProcessor;
    hooks?: TurnDaemonHooks;
}

export class TurnDaemonLifecycle {
    // 턴 데몬의 생명주기를 관리하는 루프.
    private readonly clock: Clock;
    private readonly controlQueue: TurnDaemonControlQueue;
    private readonly schedule: TurnSchedule;
    private readonly stateStore: TurnStateStore;
    private readonly processor: TurnProcessor;
    private readonly hooks?: TurnDaemonHooks;
    private readonly options: TurnDaemonLifecycleOptions;

    private status: TurnDaemonStatus;
    private pendingRun: PendingRun | null = null;
    private stopping = false;
    private loopPromise: Promise<void> | null = null;

    constructor(deps: TurnDaemonLifecycleDeps, options: TurnDaemonLifecycleOptions) {
        this.clock = deps.clock;
        this.controlQueue = deps.controlQueue;
        this.schedule = deps.schedule;
        this.stateStore = deps.stateStore;
        this.processor = deps.processor;
        this.hooks = deps.hooks;
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
            if (this.status.paused) {
                await this.waitForResume();
                continue;
            }

            if (this.pendingRun) {
                await this.runOnce(this.pendingRun);
                this.pendingRun = null;
                continue;
            }

            const nextTurnTime = this.getNextTurnTime();
            if (!nextTurnTime) {
                await this.clock.sleepMs(200);
                continue;
            }

            const nowMs = this.clock.nowMs();
            const nextTurnMs = nextTurnTime.getTime();
            if (nowMs >= nextTurnMs) {
                await this.runOnce({ reason: 'schedule', targetTime: nextTurnTime });
                continue;
            }

            const command = await this.controlQueue.waitUntil(nextTurnMs);
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
        this.status.nextTurnTime = this.schedule.getNextTurnTime(lastTurnTime).toISOString();
    }

    private getNextTurnTime(): Date | null {
        if (!this.status.lastTurnTime) {
            return null;
        }
        return this.schedule.getNextTurnTime(new Date(this.status.lastTurnTime));
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
                this.status.paused = true;
                this.status.state = 'paused';
                return;
            case 'resume':
                this.status.paused = false;
                this.status.state = 'idle';
                return;
            case 'shutdown':
                this.status.state = 'stopping';
                this.stopping = true;
                return;
            case 'run':
                this.pendingRun = {
                    reason: command.reason,
                    targetTime: command.targetTime ? new Date(command.targetTime) : undefined,
                    budget: command.budget,
                };
                this.status.pendingReason = command.reason;
                return;
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

        try {
            result = await this.processor.run(targetTime, budget, checkpoint);
        } finally {
            this.status.running = false;
        }

        this.status.state = 'flushing';
        await this.stateStore.saveLastTurnTime(new Date(result.lastTurnTime));
        await this.stateStore.saveCheckpoint(result.checkpoint);
        await this.hooks?.flushChanges?.(result);
        await this.hooks?.publishEvents?.(result);
        this.applyRunResult(result, startMs);
        this.status.state = 'idle';
    }

    private applyRunResult(result: TurnRunResult, startMs: number): void {
        this.status.lastRunAt = new Date(startMs).toISOString();
        this.status.lastDurationMs = Math.max(0, this.clock.nowMs() - startMs);
        this.status.lastTurnTime = result.lastTurnTime;
        this.status.checkpoint = result.checkpoint;
        const nextTurnTime = this.schedule.getNextTurnTime(new Date(result.lastTurnTime));
        this.status.nextTurnTime = nextTurnTime.toISOString();
    }
}
