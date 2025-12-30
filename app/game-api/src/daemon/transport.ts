import type { TurnDaemonCommand, TurnDaemonStatus } from './types.js';

export interface TurnDaemonTransport {
    sendCommand(command: TurnDaemonCommand): Promise<string>;
    requestStatus(timeoutMs?: number): Promise<TurnDaemonStatus | null>;
}
