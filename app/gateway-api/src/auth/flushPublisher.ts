import {
    buildSessionRevocationBaselineKey,
    buildUserSessionRevocationKey,
    SessionRevocationCommandBudget,
} from '@sammo-ts/common/auth/sessionRevocation';

interface RedisClientLike {
    readonly isReady?: boolean;
    set(key: string, value: string, options: { NX: true }): Promise<string | null>;
    eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
    withAbortSignal?(signal: AbortSignal): RedisClientLike;
}

// 지속 watermark를 먼저 저장한 뒤 알림을 보낸다. 구독자가 0이어도 회수는 유효하다.
const PUBLISH_FLUSH_SCRIPT = `
redis.call('SET', KEYS[1], ARGV[1], 'NX')
local raw = redis.call('GET', KEYS[2])
local prior = tonumber(raw)
if raw and not prior then return redis.error_reply('Invalid session revocation state') end
local cutoff = math.max(prior or 0, tonumber(ARGV[1]))
redis.call('SET', KEYS[2], string.format('%.0f', cutoff))
redis.call('PUBLISH', ARGV[2], ARGV[3])
return 1
`;

export interface GatewayUserFlushEvent {
    userId: string;
    flushedAt: string;
    reason?: string;
    iconRevision?: string;
    displayName?: string;
    identityRevision?: string;
}

export interface GatewayFlushPublisher {
    publishUserFlush(
        userId: string,
        reason?: string,
        metadata?: { iconRevision?: string; displayName?: string; identityRevision?: string }
    ): Promise<void>;
}

export class RedisGatewayFlushPublisher implements GatewayFlushPublisher {
    private readonly channel: string;
    private readonly client: RedisClientLike;
    private readonly commands = new SessionRevocationCommandBudget(32);

    constructor(client: RedisClientLike, channel: string) {
        this.client = client;
        this.channel = channel;
    }

    private commandClient(): RedisClientLike {
        if (this.client.isReady === false) throw new Error('Session revocation storage is unavailable.');
        return this.client.withAbortSignal?.(AbortSignal.timeout(2000)) ?? this.client;
    }

    async initialize(): Promise<void> {
        // 새 계약 최초 활성화에서만 기존 게임 credential을 회수한다. 재시작은 cutoff를 보존한다.
        await this.commands.run(() =>
            this.commandClient().set(buildSessionRevocationBaselineKey(this.channel), String(Date.now()), {
                NX: true,
            })
        );
    }

    async publishUserFlush(
        userId: string,
        reason?: string,
        metadata?: { iconRevision?: string; displayName?: string; identityRevision?: string }
    ): Promise<void> {
        const payload: GatewayUserFlushEvent = {
            userId,
            flushedAt: new Date().toISOString(),
            reason,
            ...(metadata?.iconRevision ? { iconRevision: metadata.iconRevision } : {}),
            ...(metadata?.displayName ? { displayName: metadata.displayName } : {}),
            ...(metadata?.identityRevision ? { identityRevision: metadata.identityRevision } : {}),
        };
        const result = await this.commands.run(() =>
            this.commandClient().eval(PUBLISH_FLUSH_SCRIPT, {
                keys: [
                    buildSessionRevocationBaselineKey(this.channel),
                    buildUserSessionRevocationKey(this.channel, userId),
                ],
                arguments: [String(Date.parse(payload.flushedAt)), this.channel, JSON.stringify(payload)],
            })
        );
        if (result !== 1) throw new Error('Session revocation persistence failed.');
    }
}
