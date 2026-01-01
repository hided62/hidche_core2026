export type TurnDaemonState = 'idle' | 'running' | 'flushing' | 'paused' | 'stopping';

export type RunReason = 'schedule' | 'manual' | 'poke';

export interface TurnRunBudget {
    budgetMs: number;
    maxGenerals: number;
    catchUpCap: number;
}

export interface TurnCheckpoint {
    turnTime: string;
    generalId?: number;
    year: number;
    month: number;
}

export interface TurnRunResult {
    lastTurnTime: string;
    processedGenerals: number;
    processedTurns: number;
    durationMs: number;
    partial: boolean;
    checkpoint?: TurnCheckpoint;
}

export interface TurnDaemonStatus {
    state: TurnDaemonState;
    running: boolean;
    paused: boolean;
    lastError?: string;
    lastRunAt?: string;
    lastDurationMs?: number;
    lastTurnTime?: string;
    nextTurnTime?: string;
    pendingReason?: RunReason;
    queueDepth: number;
    checkpoint?: TurnCheckpoint;
}

export type TurnDaemonCommand =
    | { type: 'run'; reason: RunReason; targetTime?: string; budget?: TurnRunBudget }
    | { type: 'pause'; reason?: string }
    | { type: 'resume'; reason?: string }
    | { type: 'shutdown'; reason?: string };

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
