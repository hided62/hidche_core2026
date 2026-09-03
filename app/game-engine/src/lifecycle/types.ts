import type {
    TurnCheckpoint,
    TurnDaemonCommand,
    TurnDaemonCommandResult,
    TurnDaemonStatus,
    TurnRunBudget,
    TurnRunResult,
} from '@sammo-ts/common';
import type { GamePrisma } from '@sammo-ts/infra';
import type { GameClockMode, GameClockPhase } from '@sammo-ts/common';

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
    handle(
        command: TurnDaemonCommand,
        context?: TurnDaemonCommandExecutionContext
    ): Promise<TurnDaemonCommandResult | null>;
}

export interface TurnDaemonCommandExecutionContext {
    db?: GamePrisma.TransactionClient;
    clockOperationAuthority?: {
        kind: 'DAEMON';
        profileName: string;
        ownerId: string;
        fencingEpoch: bigint;
    };
}

export interface TurnDaemonCommandResponder {
    publishStatus(requestId: string, status: TurnDaemonStatus): Promise<void>;
    publishCommandResult(requestId: string, result: TurnDaemonCommandResult): Promise<void>;
    publishCommandError?(requestId: string, error: unknown): Promise<void>;
}

export type { Clock } from '@sammo-ts/common';

export type NextTickTimeResolver = (lastTurnTime: Date) => Date;

export interface TurnProcessor {
    run(targetTime: Date, budget: TurnRunBudget, checkpoint?: TurnCheckpoint): Promise<TurnRunResult>;
}

export interface RealtimeBacklogRebaseResult {
    skippedTurns: number;
    shiftedTicks: number;
    lastTurnTime: string;
    checkpoint?: TurnCheckpoint;
}

export interface TurnStateStore {
    loadLastTurnTime(): Promise<Date>;
    // 월드에서 관리하는 턴 대기열의 선두(가장 이른 장수 턴 시간)를 조회한다.
    loadNextGeneralTurnTime(): Promise<Date | null>;
    saveLastTurnTime(turnTime: Date): Promise<void>;
    loadCheckpoint(): Promise<TurnCheckpoint | undefined>;
    saveCheckpoint(checkpoint?: TurnCheckpoint): Promise<void>;
    shouldHaltScheduledRuns?(): Promise<boolean>;
    loadGameClock?(wallNow?: Date): Promise<{
        mode: GameClockMode;
        now: Date;
        phase?: GameClockPhase;
        revision?: number;
        deadlineGeneration?: number;
    }>;
    promotePreopenAtOpening?(wallNow: Date): Promise<boolean>;
    shouldRebaseRealtimeBacklog?(wallNow: Date): Promise<boolean>;
    rebaseRealtimeBacklog?(wallNow: Date): Promise<RealtimeBacklogRebaseResult | null>;
    advanceGameClockTo?(target: Date, wallNow: Date): Promise<void>;
}

export interface TurnDaemonControlQueue {
    enqueue(command: TurnDaemonCommand): void;
    drain(): Promise<TurnDaemonCommand[]>;
    waitFor(timeoutMs: number | null): Promise<TurnDaemonCommand | null>;
    getDepth(): number;
}

export interface TurnDaemonHooks {
    flushChanges?(result: TurnRunResult): Promise<void>;
    commitCommand?(requestId: string, result: TurnDaemonCommandResult): Promise<void>;
    executeCommand?(
        requestId: string,
        execute: (context: TurnDaemonCommandExecutionContext) => Promise<TurnDaemonCommandResult>
    ): Promise<TurnDaemonCommandResult>;
    publishCommandEvents?(result: TurnDaemonCommandResult): Promise<void>;
    publishEvents?(result: TurnRunResult): Promise<void>;
    onRunError?(error: unknown): Promise<void>;
}
