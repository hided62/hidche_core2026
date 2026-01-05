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
    deletedGenerals?: number[];
    deletedTroops?: number[];
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
    | { type: 'troopExit'; requestId?: string; generalId: number }
    | { type: 'dieOnPrestart'; requestId?: string; generalId: number }
    | { type: 'buildNationCandidate'; requestId?: string; generalId: number }
    | { type: 'instantRetreat'; requestId?: string; generalId: number }
    | { type: 'vacation'; requestId?: string; generalId: number }
    | {
          type: 'setMySetting';
          requestId?: string;
          generalId: number;
          settings: {
              tnmt?: number;
              defence_train?: number;
              use_treatment?: number;
              use_auto_nation_turn?: number;
          };
      }
    | { type: 'dropItem'; requestId?: string; generalId: number; itemType: string }
    | {
          type: 'changePermission';
          requestId?: string;
          generalId: number;
          isAmbassador: boolean;
          targetGeneralIds: number[];
      }
    | { type: 'kick'; requestId?: string; generalId: number; destGeneralId: number }
    | {
          type: 'appoint';
          requestId?: string;
          generalId: number;
          destGeneralId: number;
          destCityId: number;
          officerLevel: number;
      };

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
      }
    | { type: 'dieOnPrestart'; ok: boolean; generalId: number; reason?: string }
    | { type: 'buildNationCandidate'; ok: boolean; generalId: number; reason?: string }
    | { type: 'instantRetreat'; ok: boolean; generalId: number; reason?: string }
    | { type: 'vacation'; ok: boolean; generalId: number; reason?: string }
    | { type: 'setMySetting'; ok: boolean; generalId: number; reason?: string }
    | { type: 'dropItem'; ok: boolean; generalId: number; reason?: string }
    | { type: 'changePermission'; ok: boolean; generalId: number; reason?: string }
    | { type: 'kick'; ok: boolean; generalId: number; reason?: string }
    | { type: 'appoint'; ok: boolean; generalId: number; reason?: string };

export type TurnDaemonEvent =
    | { type: 'status'; requestId?: string; status: TurnDaemonStatus }
    | { type: 'runStarted'; at: string; reason: RunReason }
    | { type: 'runCompleted'; at: string; result: TurnRunResult }
    | { type: 'runFailed'; at: string; error: string }
    | { type: 'commandResult'; result: TurnDaemonCommandResult };
