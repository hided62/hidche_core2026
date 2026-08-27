import { readonly, ref, type Ref } from 'vue';

export const GAME_SERVER_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000] as const;
export const GAME_SERVER_RECONNECTED_EVENT = 'sammo:game-server-reconnected';

export type GameServerConnectionStatus = 'connected' | 'reconnecting';

export type GameServerConnectionTracker = {
    status: Readonly<Ref<GameServerConnectionStatus>>;
    markFailure: () => void;
    markConnected: () => void;
};

export const isRetryableGameServerStatus = (status: number): boolean =>
    status === 502 || status === 503 || status === 504;

export const canConfirmGameServerRecovery = (status: number): boolean => status < 500;

export const isGameServerRecoveryRequest = (input: RequestInfo | URL): boolean => {
    const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    try {
        const operationList = decodeURIComponent(new URL(rawUrl, 'http://game.local').pathname).split('/').at(-1);
        return operationList?.split(',').includes('lobby.info') ?? false;
    } catch {
        return false;
    }
};

export const isAbortedGameServerRequest = (error: unknown): boolean =>
    error instanceof DOMException && error.name === 'AbortError';

export const retryDelayForFailure = (failureCount: number): number =>
    GAME_SERVER_RETRY_DELAYS_MS[
        Math.min(Math.max(0, Math.trunc(failureCount) - 1), GAME_SERVER_RETRY_DELAYS_MS.length - 1)
    ];

export const createGameServerConnectionTracker = (): GameServerConnectionTracker => {
    const status = ref<GameServerConnectionStatus>('connected');

    return {
        status: readonly(status),
        markFailure() {
            status.value = 'reconnecting';
        },
        markConnected() {
            status.value = 'connected';
        },
    };
};

export const gameServerConnection = createGameServerConnectionTracker();

export const markGameServerConnectionFailure = (): void => gameServerConnection.markFailure();
export const markGameServerConnectionReady = (): void => gameServerConnection.markConnected();
