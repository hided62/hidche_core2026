import {
    buildSessionRevocationBaselineKey,
    buildUserSessionRevocationKey,
    parseSessionRevocationWatermark,
    SessionRevocationCommandBudget,
} from '@sammo-ts/common/auth/sessionRevocation';

export interface GatewayUserFlushEvent {
    userId: string;
    flushedAt: string;
    reason?: string;
    iconRevision?: string;
    displayName?: string;
    identityRevision?: string;
}

export interface FlushStore {
    getFlushedAt(userId: string): Date | null | Promise<Date | null>;
    applyFlush(event: GatewayUserFlushEvent): void;
}

export class InMemoryFlushStore implements FlushStore {
    private readonly flushedAtByUser = new Map<string, Date>();

    getFlushedAt(userId: string): Date | null {
        return this.flushedAtByUser.get(userId) ?? null;
    }

    applyFlush(event: GatewayUserFlushEvent): void {
        const parsed = new Date(event.flushedAt);
        if (Number.isNaN(parsed.getTime())) {
            return;
        }
        const existing = this.flushedAtByUser.get(event.userId);
        if (!existing || parsed > existing) {
            this.flushedAtByUser.set(event.userId, parsed);
        }
    }
}

interface RevocationRedisClient {
    readonly isReady?: boolean;
    mGet(keys: string[]): Promise<(string | null)[]>;
    withAbortSignal?(signal: AbortSignal): RevocationRedisClient;
}

/** Pub/sub accelerates closure; Redis is checked again at every authorization boundary. */
export class RedisFlushStore implements FlushStore {
    private readonly local = new Map<string, Date>();
    private readonly commands = new SessionRevocationCommandBudget(64);
    constructor(
        private readonly client: RevocationRedisClient,
        private readonly channel: string
    ) {}

    private commandClient(): RevocationRedisClient {
        if (this.client.isReady === false) throw new Error('Session revocation storage is unavailable.');
        return this.client.withAbortSignal?.(AbortSignal.timeout(2000)) ?? this.client;
    }

    async assertInitialized(): Promise<void> {
        const values = await this.commands.run(() =>
            this.commandClient().mGet([buildSessionRevocationBaselineKey(this.channel)])
        );
        if (values.length !== 1 || !parseSessionRevocationWatermark(values[0]!))
            throw new Error('Gateway session revocation must be initialized before game API startup.');
    }

    async getFlushedAt(userId: string): Promise<Date | null> {
        const values = await this.commands.run(() =>
            this.commandClient().mGet([
                buildSessionRevocationBaselineKey(this.channel),
                buildUserSessionRevocationKey(this.channel, userId),
            ])
        );
        if (values.length !== 2) throw new Error('Session revocation storage is unavailable.');
        const baseline = parseSessionRevocationWatermark(values[0]!);
        if (!baseline) throw new Error('Session revocation storage is unavailable.');
        const persisted = parseSessionRevocationWatermark(values[1]!);
        return new Date(
            Math.max(baseline.getTime(), persisted?.getTime() ?? 0, this.local.get(userId)?.getTime() ?? 0)
        );
    }

    applyFlush(event: GatewayUserFlushEvent): void {
        const parsed = new Date(event.flushedAt);
        if (Number.isNaN(parsed.getTime())) return;
        const prior = this.local.get(event.userId);
        if (!prior || parsed > prior) {
            this.local.delete(event.userId);
            this.local.set(event.userId, parsed);
        }
        // 이 캐시는 재시작/eviction 뒤에도 Redis watermark를 확인하므로 권한 근거가 아니다.
        if (this.local.size > 4096) this.local.delete(this.local.keys().next().value!);
    }
}

export class RedisGatewayFlushSubscriber {
    private readonly client: {
        subscribe: (channel: string, listener: (message: string) => void) => Promise<void>;
        unsubscribe: (channel: string) => Promise<void>;
    };
    private readonly channel: string;
    private readonly store: FlushStore;
    private readonly onFlush?: (event: GatewayUserFlushEvent) => Promise<void> | void;
    private readonly onFlushError?: (error: unknown, event: GatewayUserFlushEvent) => void;
    private readonly pendingFlushes = new Set<Promise<void>>();

    constructor(
        client: {
            subscribe: (channel: string, listener: (message: string) => void) => Promise<void>;
            unsubscribe: (channel: string) => Promise<void>;
        },
        channel: string,
        store: FlushStore,
        onFlush?: (event: GatewayUserFlushEvent) => Promise<void> | void,
        onFlushError?: (error: unknown, event: GatewayUserFlushEvent) => void
    ) {
        this.client = client;
        this.channel = channel;
        this.store = store;
        this.onFlush = onFlush;
        this.onFlushError = onFlushError;
    }

    async start(): Promise<void> {
        await this.client.subscribe(this.channel, (message) => {
            try {
                const payload = JSON.parse(message) as GatewayUserFlushEvent;
                if (!payload || typeof payload.userId !== 'string') {
                    return;
                }
                this.store.applyFlush(payload);
                if (this.onFlush) {
                    let flush: Promise<void>;
                    try {
                        flush = Promise.resolve(this.onFlush(payload));
                    } catch (error) {
                        this.onFlushError?.(error, payload);
                        return;
                    }
                    const tracked = flush
                        .catch((error: unknown) => {
                            this.onFlushError?.(error, payload);
                        })
                        .finally(() => {
                            this.pendingFlushes.delete(tracked);
                        });
                    this.pendingFlushes.add(tracked);
                }
            } catch {
                return;
            }
        });
    }

    async stop(): Promise<void> {
        await this.client.unsubscribe(this.channel);
        await Promise.all(this.pendingFlushes);
    }
}
