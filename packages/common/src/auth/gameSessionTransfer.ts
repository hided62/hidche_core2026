export const GAME_SESSION_TRANSFER_STORAGE_KEY = 'sammo-pending-game-session';

export interface GameSessionTransfer {
    profile: string;
    gatewayToken: string;
}

export interface GameSessionTransferStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

const isGameSessionTransfer = (value: unknown): value is GameSessionTransfer => {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const candidate = value as Partial<GameSessionTransfer>;
    return (
        typeof candidate.profile === 'string' &&
        candidate.profile.trim().length > 0 &&
        typeof candidate.gatewayToken === 'string' &&
        candidate.gatewayToken.trim().length > 0
    );
};

export const writeGameSessionTransfer = (
    storage: GameSessionTransferStorage,
    transfer: GameSessionTransfer
): boolean => {
    try {
        storage.setItem(GAME_SESSION_TRANSFER_STORAGE_KEY, JSON.stringify(transfer));
        return true;
    } catch {
        return false;
    }
};

export const takeGameSessionTransfer = (storage: GameSessionTransferStorage): GameSessionTransfer | null => {
    let raw: string | null;
    try {
        raw = storage.getItem(GAME_SESSION_TRANSFER_STORAGE_KEY);
        storage.removeItem(GAME_SESSION_TRANSFER_STORAGE_KEY);
    } catch {
        return null;
    }
    if (!raw) {
        return null;
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        return isGameSessionTransfer(parsed) ? parsed : null;
    } catch {
        return null;
    }
};
