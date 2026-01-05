import { randomUUID } from 'node:crypto';

import type {
    TurnDaemonCommand,
    TurnDaemonCommandEnvelope,
    TurnDaemonCommandResult,
    TurnDaemonStatus,
} from './types.js';
import type { TurnDaemonTransport } from './transport.js';

const buildDefaultStatus = (): TurnDaemonStatus => ({
    state: 'idle',
    running: false,
    paused: false,
    queueDepth: 0,
});

// 턴 데몬 통신을 메모리 큐로 흉내 내는 테스트용 전송기.
export class InMemoryTurnDaemonTransport implements TurnDaemonTransport {
    public readonly commands: TurnDaemonCommandEnvelope[] = [];
    private status: TurnDaemonStatus;
    private readonly results = new Map<string, TurnDaemonCommandResult>();

    constructor(initialStatus: TurnDaemonStatus = buildDefaultStatus()) {
        this.status = initialStatus;
    }

    // 테스트용: 메모리 큐에 명령을 저장하고 requestId를 반환한다.
    async sendCommand(command: TurnDaemonCommand): Promise<string> {
        const requestId = command.type === 'getStatus' && command.requestId ? command.requestId : randomUUID();
        this.commands.push({
            requestId,
            sentAt: new Date().toISOString(),
            command,
        });
        return requestId;
    }

    async requestCommand(command: TurnDaemonCommand, _timeoutMs?: number): Promise<TurnDaemonCommandResult | null> {
        const requestId = await this.sendCommand(command);
        return this.results.get(requestId) ?? null;
    }

    async requestStatus(): Promise<TurnDaemonStatus> {
        return this.status;
    }

    setStatus(status: TurnDaemonStatus): void {
        this.status = status;
    }

    setCommandResult(requestId: string, result: TurnDaemonCommandResult): void {
        this.results.set(requestId, result);
    }
}
