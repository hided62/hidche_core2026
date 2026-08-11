import { describe, expect, it } from 'vitest';
import {
    GAME_SESSION_TRANSFER_STORAGE_KEY,
    takeGameSessionTransfer,
    writeGameSessionTransfer,
    type GameSessionTransferStorage,
} from '../src/auth/gameSessionTransfer.js';

const createStorage = (): GameSessionTransferStorage & { values: Map<string, string> } => {
    const values = new Map<string, string>();
    return {
        values,
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
    };
};

describe('game session transfer', () => {
    it('stores and consumes a valid transfer exactly once', () => {
        const storage = createStorage();
        const transfer = { profile: 'hwe:903', gatewayToken: 'encrypted-token' };

        expect(writeGameSessionTransfer(storage, transfer)).toBe(true);
        expect(storage.values.has(GAME_SESSION_TRANSFER_STORAGE_KEY)).toBe(true);
        expect(takeGameSessionTransfer(storage)).toEqual(transfer);
        expect(takeGameSessionTransfer(storage)).toBeNull();
    });

    it('removes malformed transfer data without returning it', () => {
        const storage = createStorage();
        storage.setItem(GAME_SESSION_TRANSFER_STORAGE_KEY, JSON.stringify({ profile: 'hwe:903' }));

        expect(takeGameSessionTransfer(storage)).toBeNull();
        expect(storage.values.has(GAME_SESSION_TRANSFER_STORAGE_KEY)).toBe(false);
    });

    it('reports unavailable storage so callers can use a compatibility fallback', () => {
        const unavailable: GameSessionTransferStorage = {
            getItem: () => {
                throw new Error('blocked');
            },
            setItem: () => {
                throw new Error('blocked');
            },
            removeItem: () => {
                throw new Error('blocked');
            },
        };

        expect(writeGameSessionTransfer(unavailable, { profile: 'hwe:903', gatewayToken: 'token' })).toBe(false);
        expect(takeGameSessionTransfer(unavailable)).toBeNull();
    });
});
