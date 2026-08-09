export interface BroadcastChannelLike<T> {
    onmessage: ((event: MessageEvent<T>) => void) | null;
    postMessage(message: T): void;
    close(): void;
}

type CoordinatorWireMessage<T> =
    | { kind: 'presence'; tabId: string; sentAt: number }
    | { kind: 'leave'; tabId: string; sentAt: number }
    | { kind: 'payload'; tabId: string; sentAt: number; payload: T };

export interface BroadcastTabCoordinator<T> {
    start(): void;
    stop(): void;
    isLeader(): boolean;
    postFromLeader(payload: T): boolean;
}

interface BroadcastTabCoordinatorOptions<T> {
    onLeadershipChange: (leader: boolean) => void;
    onPayload: (payload: T) => void;
    createChannel?: (name: string) => BroadcastChannelLike<CoordinatorWireMessage<T>>;
    createTabId?: () => string;
    now?: () => number;
    setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
    clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
    settleMs?: number;
    heartbeatMs?: number;
    peerExpiryMs?: number;
}

const defaultCreateTabId = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

/**
 * Elect one active tab per channel without persisting credentials or state.
 * Every participant advertises a short-lived presence lease; the lowest tab id
 * owns realtime I/O and broadcasts the fetched result to the other tabs.
 */
export const createBroadcastTabCoordinator = <T>(
    channelName: string,
    options: BroadcastTabCoordinatorOptions<T>
): BroadcastTabCoordinator<T> => {
    const createChannel =
        options.createChannel ??
        ((name: string) => new BroadcastChannel(name) as BroadcastChannelLike<CoordinatorWireMessage<T>>);
    const createTabId = options.createTabId ?? defaultCreateTabId;
    const now = options.now ?? Date.now;
    const setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
    const settleMs = Math.max(0, options.settleMs ?? 100);
    const heartbeatMs = Math.max(100, options.heartbeatMs ?? 2_000);
    const peerExpiryMs = Math.max(heartbeatMs * 2, options.peerExpiryMs ?? 5_000);
    const tabId = createTabId();

    let channel: BroadcastChannelLike<CoordinatorWireMessage<T>> | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
    let started = false;
    let settled = false;
    let leader = false;
    const peers = new Map<string, number>();

    const send = (message: CoordinatorWireMessage<T>): boolean => {
        if (!channel) return false;
        try {
            channel.postMessage(message);
            return true;
        } catch {
            // Realtime fan-out is best effort, like the SSE/Redis boundary.
            return false;
        }
    };

    const announce = () => {
        const sentAt = now();
        peers.set(tabId, sentAt);
        send({ kind: 'presence', tabId, sentAt });
    };

    const setLeader = (next: boolean) => {
        if (leader === next) return;
        leader = next;
        options.onLeadershipChange(next);
    };

    const elect = () => {
        if (!started || !settled) return;
        const cutoff = now() - peerExpiryMs;
        for (const [peerId, seenAt] of peers) {
            if (peerId !== tabId && seenAt < cutoff) peers.delete(peerId);
        }
        peers.set(tabId, now());
        const elected = [...peers.keys()].sort()[0];
        setLeader(elected === tabId);
    };

    const scheduleHeartbeat = () => {
        heartbeatTimer = setTimer(() => {
            heartbeatTimer = null;
            if (!started) return;
            announce();
            elect();
            scheduleHeartbeat();
        }, heartbeatMs);
    };

    return {
        start: () => {
            if (started) return;
            started = true;
            channel = createChannel(channelName);
            channel.onmessage = (event) => {
                const message = event.data;
                if (!message || message.tabId === tabId) return;
                if (message.kind === 'presence') {
                    const isNewPeer = !peers.has(message.tabId);
                    peers.set(message.tabId, now());
                    if (isNewPeer) announce();
                    elect();
                    return;
                }
                if (message.kind === 'leave') {
                    peers.delete(message.tabId);
                    elect();
                    return;
                }
                if (message.kind === 'payload' && !leader) {
                    peers.set(message.tabId, now());
                    options.onPayload(message.payload);
                    elect();
                }
            };
            announce();
            settleTimer = setTimer(() => {
                settleTimer = null;
                settled = true;
                elect();
            }, settleMs);
            scheduleHeartbeat();
        },
        stop: () => {
            if (!started) return;
            send({ kind: 'leave', tabId, sentAt: now() });
            started = false;
            settled = false;
            peers.clear();
            if (settleTimer !== null) clearTimer(settleTimer);
            if (heartbeatTimer !== null) clearTimer(heartbeatTimer);
            settleTimer = null;
            heartbeatTimer = null;
            channel?.close();
            channel = null;
            setLeader(false);
        },
        isLeader: () => started && leader,
        postFromLeader: (payload) => {
            if (!started || !leader) return false;
            return send({ kind: 'payload', tabId, sentAt: now(), payload });
        },
    };
};
