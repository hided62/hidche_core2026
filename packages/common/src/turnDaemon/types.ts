export type TurnDaemonState =
    | 'idle'
    | 'running'
    | 'flushing'
    | 'paused'
    | 'stopping';

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
    | {
          type: 'run';
          reason: RunReason;
          targetTime?: string;
          budget?: TurnRunBudget;
      }
    | { type: 'pause'; reason?: string }
    | { type: 'resume'; reason?: string }
    | { type: 'shutdown'; reason?: string }
    | { type: 'getStatus'; requestId?: string }
    | { type: 'troopJoin'; requestId?: string; generalId: number; troopId: number }
    | { type: 'troopExit'; requestId?: string; generalId: number };

export type TurnDaemonCommandResult =
    | {
          type: 'troopJoin';
          ok: true;
          generalId: number;
          troopId: number;
      }
    | {
          type: 'troopJoin';
          ok: false;
          generalId: number;
          troopId: number;
          reason: string;
      }
    | {
          type: 'troopExit';
          ok: true;
          generalId: number;
          wasLeader: boolean;
      }
    | {
          type: 'troopExit';
          ok: false;
          generalId: number;
          reason: string;
      };

export type TurnDaemonEvent =
    | { type: 'status'; requestId?: string; status: TurnDaemonStatus }
    | { type: 'runStarted'; at: string; reason: RunReason }
    | { type: 'runCompleted'; at: string; result: TurnRunResult }
    | { type: 'runFailed'; at: string; error: string }
    | { type: 'commandResult'; result: TurnDaemonCommandResult };
