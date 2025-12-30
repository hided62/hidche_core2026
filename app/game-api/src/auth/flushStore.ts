export interface GatewayUserFlushEvent {
    userId: string;
    flushedAt: string;
    reason?: string;
}

export interface FlushStore {
    getFlushedAt(userId: string): Date | null;
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

export class RedisGatewayFlushSubscriber {
    private readonly client: {
        subscribe: (channel: string, listener: (message: string) => void) => Promise<void>;
        unsubscribe: (channel: string) => Promise<void>;
    };
    private readonly channel: string;
    private readonly store: FlushStore;

    constructor(
        client: {
            subscribe: (channel: string, listener: (message: string) => void) => Promise<void>;
            unsubscribe: (channel: string) => Promise<void>;
        },
        channel: string,
        store: FlushStore
    ) {
        this.client = client;
        this.channel = channel;
        this.store = store;
    }

    async start(): Promise<void> {
        await this.client.subscribe(this.channel, (message) => {
            try {
                const payload = JSON.parse(message) as GatewayUserFlushEvent;
                if (!payload || typeof payload.userId !== 'string') {
                    return;
                }
                this.store.applyFlush(payload);
            } catch {
                return;
            }
        });
    }

    async stop(): Promise<void> {
        await this.client.unsubscribe(this.channel);
    }
}
