import type { TurnDaemonCommand, TurnDaemonEvent } from '@sammo-ts/common';

export type {
    RunReason,
    TurnCheckpoint,
    TurnDaemonCommand,
    TurnDaemonCommandResult,
    TurnDaemonEvent,
    TurnDaemonState,
    TurnDaemonStatus,
    TurnRunBudget,
    TurnRunResult,
} from '@sammo-ts/common';

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
