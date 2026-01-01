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

// 턴 데몬 제어 요청은 Redis 스트림으로 전달한다.
export type TurnDaemonCommand =
    | { type: 'run'; reason: RunReason; targetTime?: string; budget?: TurnRunBudget }
    | { type: 'pause'; reason?: string }
    | { type: 'resume'; reason?: string }
    | { type: 'getStatus'; requestId: string };

// 턴 데몬 이벤트는 상태/실행 결과를 API 서버에 알려준다.
export type TurnDaemonEvent =
    | { type: 'status'; requestId?: string; status: TurnDaemonStatus }
    | { type: 'runStarted'; at: string; reason: RunReason }
    | { type: 'runCompleted'; at: string; result: TurnRunResult }
    | { type: 'runFailed'; at: string; error: string };

export interface TurnDaemonCommandEnvelope {
    requestId: string;
    sentAt: string;
    command: TurnDaemonCommand;
}

export interface TurnDaemonEventEnvelope {
    requestId?: string;
    sentAt: string;
    event: TurnDaemonEvent;
}
