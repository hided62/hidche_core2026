import { PassThrough } from 'node:stream';
import type { ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import { AuthenticatedRealtimeConnection } from '../src/realtime/authenticatedConnection.js';

const payload = (): GameSessionTokenPayload => ({
    version: 1,
    sessionId: 'test-session',
    profile: 'che:default',
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    user: {
        id: 'test-user',
        username: 'test',
        displayName: 'test',
        roles: ['user'],
        createdAt: new Date().toISOString(),
    },
    sanctions: {},
});
const fixture = (resolve: () => Promise<GameSessionTokenPayload | null>, auth = payload()) => {
    const response = new PassThrough();
    const frames: string[] = [];
    response.on('data', (chunk) => frames.push(String(chunk)));
    const connection = new AuthenticatedRealtimeConnection(auth, response as unknown as ServerResponse, resolve);
    return { response, frames, connection };
};
afterEach(() => vi.useRealTimers());

describe('authenticated realtime connection', () => {
    it('does not forward an in-flight result after the token is revoked during its work', async () => {
        const auth = payload();
        let current: GameSessionTokenPayload | null = auth;
        const { connection, frames } = fixture(async () => current, auth);
        connection.enqueue(async () => {
            current = null;
            return 'private invalidation';
        });
        await vi.waitFor(() => expect(connection.closed).toBe(true));
        expect(frames).toEqual([]);
    });
    it.each(['sessionId', 'profile'] as const)('rejects a replacement %s even for the same user', async (field) => {
        const auth = payload();
        const { connection, frames } = fixture(async () => ({ ...auth, [field]: 'replacement' }), auth);
        connection.enqueue(async () => 'private invalidation');
        await vi.waitFor(() => expect(connection.closed).toBe(true));
        expect(frames).toEqual([]);
    });
    it('fails closed when authentication storage fails', async () => {
        const { connection, frames } = fixture(async () => {
            throw new Error('redis unavailable');
        });
        connection.enqueue(async () => 'private invalidation');
        await vi.waitFor(() => expect(connection.closed).toBe(true));
        expect(frames).toEqual([]);
    });
    it('ends an idle expired stream and releases subscriptions only once', async () => {
        vi.useFakeTimers();
        const auth = payload();
        const { connection } = fixture(async () => auth, auth);
        const cleanup = vi.fn();
        connection.onClose(cleanup);
        await vi.advanceTimersByTimeAsync(60_001);
        expect(connection.closed).toBe(true);
        expect(cleanup).toHaveBeenCalledTimes(1);
        connection.close();
        expect(cleanup).toHaveBeenCalledTimes(1);
    });
    it('bounds queued work while an earlier event is blocked', async () => {
        const auth = payload();
        const { connection, frames } = fixture(async () => auth, auth);
        let release!: () => void;
        const waiting = new Promise<void>((resolve) => {
            release = resolve;
        });
        connection.enqueue(async () => {
            await waiting;
            return 'private invalidation';
        });
        for (let i = 0; i < 100; i += 1) connection.enqueue(async () => 'private invalidation');
        expect(connection.closed).toBe(true);
        release();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(frames).toEqual([]);
    });
    it('ends a slow socket instead of retaining further frames', async () => {
        const auth = payload();
        const { connection, response } = fixture(async () => auth, auth);
        response.write = vi.fn(() => false);
        connection.enqueue(async () => 'event: ping\ndata: {}\n\n');
        await vi.waitFor(() => expect(connection.closed).toBe(true));
        expect(response.writableEnded).toBe(true);
    });
});
