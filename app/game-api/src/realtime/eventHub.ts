import type { RedisConnector } from '@sammo-ts/infra';
import type { RealtimeEvent } from '@sammo-ts/common';

export type RealtimeListener = (event: RealtimeEvent) => void;

export const parseRealtimeEvent = (message: string): RealtimeEvent | null => {
    if (!message) {
        return null;
    }
    try {
        const parsed = JSON.parse(message) as RealtimeEvent;
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }
        if (typeof parsed.type !== 'string') {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
};

// Redis pub/sub 이벤트를 SSE 구독자에게 전달하는 중계 허브.
export class RedisRealtimeEventHub {
    private readonly listeners = new Set<RealtimeListener>();
    private subscribed = false;

    constructor(
        private readonly redis: RedisConnector['client'],
        private readonly channel: string
    ) {}

    async start(): Promise<void> {
        if (this.subscribed) {
            return;
        }
        await this.redis.subscribe(this.channel, (message) => {
            const event = parseRealtimeEvent(message);
            if (!event) {
                return;
            }
            for (const listener of this.listeners) {
                listener(event);
            }
        });
        this.subscribed = true;
    }

    subscribe(listener: RealtimeListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    async stop(): Promise<void> {
        if (this.subscribed) {
            await this.redis.unsubscribe(this.channel);
            this.subscribed = false;
        }
        await this.redis.quit();
    }
}
