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
    private readonly client: { publish: (channel: string, message: string) => Promise<number> };

    constructor(client: { publish: (channel: string, message: string) => Promise<number> }, channel: string) {
        this.client = client;
        this.channel = channel;
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
        await this.client.publish(this.channel, JSON.stringify(payload));
    }
}
