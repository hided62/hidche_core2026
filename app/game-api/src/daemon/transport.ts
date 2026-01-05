import type { TurnDaemonCommand, TurnDaemonCommandResult, TurnDaemonStatus } from './types.js';

export interface TurnDaemonTransport {
    sendCommand(command: TurnDaemonCommand): Promise<string>;
    requestCommand(command: TurnDaemonCommand, timeoutMs?: number): Promise<TurnDaemonCommandResult | null>;
    requestStatus(timeoutMs?: number): Promise<TurnDaemonStatus | null>;
}
