import type {
    TurnCheckpoint,
    TurnDaemonCommand,
    TurnDaemonCommandResult,
    TurnDaemonStatus,
    TurnRunBudget,
    TurnRunResult,
} from '@sammo-ts/common';

export type {
    RunReason,
    TurnCheckpoint,
    TurnDaemonCommand,
    TurnDaemonCommandResult,
    TurnDaemonState,
    TurnDaemonStatus,
    TurnRunBudget,
    TurnRunResult,
} from '@sammo-ts/common';

export interface TurnDaemonCommandHandler {
    handle(command: TurnDaemonCommand): Promise<TurnDaemonCommandResult | null>;
}

export interface TurnDaemonCommandResponder {
    publishStatus(requestId: string, status: TurnDaemonStatus): Promise<void>;
    publishCommandResult(requestId: string, result: TurnDaemonCommandResult): Promise<void>;
}

export type { Clock } from '@sammo-ts/common';

export type NextTickTimeResolver = (lastTurnTime: Date) => Date;

export interface TurnProcessor {
    run(targetTime: Date, budget: TurnRunBudget, checkpoint?: TurnCheckpoint): Promise<TurnRunResult>;
}

export interface TurnStateStore {
    loadLastTurnTime(): Promise<Date>;
    // 월드에서 관리하는 턴 대기열의 선두(가장 이른 장수 턴 시간)를 조회한다.
    loadNextGeneralTurnTime(): Promise<Date | null>;
    saveLastTurnTime(turnTime: Date): Promise<void>;
    loadCheckpoint(): Promise<TurnCheckpoint | undefined>;
    saveCheckpoint(checkpoint?: TurnCheckpoint): Promise<void>;
}

export interface TurnDaemonControlQueue {
    enqueue(command: TurnDaemonCommand): void;
    drain(): Promise<TurnDaemonCommand[]>;
    waitUntil(deadlineMs: number | null): Promise<TurnDaemonCommand | null>;
    getDepth(): number;
}

export interface TurnDaemonHooks {
    flushChanges?(result: TurnRunResult): Promise<void>;
    publishEvents?(result: TurnRunResult): Promise<void>;
    onRunError?(error: unknown): Promise<void>;
}
