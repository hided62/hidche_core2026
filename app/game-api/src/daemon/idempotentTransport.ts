import type { TurnDaemonTransport } from './transport.js';
import type { TurnDaemonCommand, TurnDaemonCommandResult, TurnDaemonStatus } from './types.js';

export class IdempotentTurnDaemonTransport implements TurnDaemonTransport {
    private sequence = 0;

    constructor(
        private readonly transport: TurnDaemonTransport,
        private readonly parentRequestId: string
    ) {}

    async sendCommand(command: TurnDaemonCommand): Promise<string> {
        return this.transport.sendCommand(this.scope(command));
    }

    async requestCommand(command: TurnDaemonCommand, timeoutMs?: number): Promise<TurnDaemonCommandResult | null> {
        return this.transport.requestCommand(this.scope(command), timeoutMs);
    }

    async requestStatus(timeoutMs?: number): Promise<TurnDaemonStatus | null> {
        return this.transport.requestStatus(timeoutMs);
    }

    private scope(command: TurnDaemonCommand): TurnDaemonCommand {
        const requestId = `${this.parentRequestId}:engine:${this.sequence++}:${command.type}`;
        return { ...command, requestId } as TurnDaemonCommand;
    }
}
