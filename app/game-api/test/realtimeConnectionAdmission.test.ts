import { afterEach, describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import type { ServerResponse } from 'node:http';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import { RealtimeConnectionAdmission } from '../src/realtime/connectionAdmission.js';
import { AuthenticatedRealtimeConnection } from '../src/realtime/authenticatedConnection.js';

afterEach(() => vi.useRealTimers());

describe('realtime connection admission', () => {
    it('reserves the process total before authentication and counts live streams too', () => {
        const budget = new RealtimeConnectionAdmission({ connections: 2, perUser: 2, opening: 2 });
        const first = budget.begin(vi.fn())!;
        const second = budget.begin(vi.fn())!;
        expect(first.reserveUser('actor')).toBe(true);
        expect(first.startStreaming()).toBe(true);
        expect(budget.begin(vi.fn())).toBeNull();
        second.release();
        const replacement = budget.begin(vi.fn())!;
        expect(replacement).not.toBeNull();
        replacement.release();
        first.release();
    });

    it('shares the authenticated actor limit while allowing another actor', () => {
        const budget = new RealtimeConnectionAdmission({ connections: 5, perUser: 1, opening: 5 });
        const first = budget.begin(vi.fn())!;
        expect(first.reserveUser('one')).toBe(true);
        const rejected = budget.begin(vi.fn())!;
        expect(rejected.reserveUser('one')).toBe(false);
        expect(rejected.startStreaming()).toBe(false);
        rejected.release();
        const other = budget.begin(vi.fn())!;
        expect(other.reserveUser('two')).toBe(true);
        first.release();
        first.release();
        const replacement = budget.begin(vi.fn())!;
        expect(replacement.reserveUser('one')).toBe(true);
        other.release();
        replacement.release();
    });

    it('keeps timed-out and disconnected backend work admitted until it actually settles', async () => {
        vi.useFakeTimers();
        const budget = new RealtimeConnectionAdmission({ connections: 5, perUser: 5, opening: 2 });
        const timeout = vi.fn();
        const stalled = budget.begin(timeout)!;
        const disconnected = budget.begin(vi.fn())!;
        expect(stalled.reserveUser('stalled')).toBe(true);
        disconnected.cancelOpening();
        await vi.advanceTimersByTimeAsync(5000);
        expect(timeout).toHaveBeenCalledTimes(1);
        expect(stalled.canContinue()).toBe(false);
        expect(stalled.startStreaming()).toBe(false);
        expect(disconnected.canContinue()).toBe(false);
        expect(budget.begin(vi.fn())).toBeNull();
        stalled.release();
        const recovered = budget.begin(vi.fn())!;
        expect(recovered.reserveUser('stalled')).toBe(true);
        expect(recovered.startStreaming()).toBe(true);
        await vi.advanceTimersByTimeAsync(5000);
        expect(timeout).toHaveBeenCalledTimes(1);
        disconnected.release();
        recovered.release();
    });

    it('stops pending setup on shutdown and permanently refuses new admissions', () => {
        const budget = new RealtimeConnectionAdmission();
        const timeout = vi.fn();
        const pending = budget.begin(timeout)!;
        budget.close();
        budget.close();
        expect(timeout).toHaveBeenCalledTimes(1);
        expect(pending.canContinue()).toBe(false);
        expect(budget.begin(vi.fn())).toBeNull();
        pending.release();
    });

    it('keeps a closed stream counted while its in-flight authentication is still pending', async () => {
        const budget = new RealtimeConnectionAdmission({ connections: 1, perUser: 1, opening: 1 });
        const slot = budget.begin(vi.fn())!;
        expect(slot.reserveUser('actor')).toBe(true);
        expect(slot.startStreaming()).toBe(true);
        let finish!: () => void;
        let started!: () => void;
        const inFlight = new Promise<void>((resolve) => {
            finish = resolve;
        });
        const running = new Promise<void>((resolve) => {
            started = resolve;
        });
        const auth: GameSessionTokenPayload = {
            version: 1,
            sessionId: 'session',
            profile: 'che:default',
            issuedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            user: {
                id: 'actor',
                username: 'actor',
                displayName: 'actor',
                roles: ['user'],
                createdAt: new Date().toISOString(),
            },
            sanctions: {},
        };
        const response = new PassThrough();
        const connection = new AuthenticatedRealtimeConnection(
            auth,
            response as unknown as ServerResponse,
            async () => {
                started();
                await inFlight;
                return auth;
            }
        );
        connection.onClose(() => {
            void connection.whenIdle().then(slot.release, slot.release);
        });
        connection.enqueue(async () => 'event: ready\ndata: {}\n\n');
        await running;
        connection.close();
        expect(budget.begin(vi.fn())).toBeNull();
        finish();
        await connection.whenIdle();
        const replacement = budget.begin(vi.fn())!;
        expect(replacement.reserveUser('actor')).toBe(true);
        replacement.release();
    });

    it('enforces the production 512 total and 32 pending openings without accumulating a queue', () => {
        const budget = new RealtimeConnectionAdmission();
        const pending = Array.from({ length: 32 }, () => budget.begin(vi.fn())!);
        expect(pending.every(Boolean)).toBe(true);
        expect(budget.begin(vi.fn())).toBeNull();
        for (const slot of pending) slot.release();
        const live = Array.from({ length: 512 }, (_, index) => {
            const slot = budget.begin(vi.fn())!;
            expect(slot.reserveUser(`actor-${index}`)).toBe(true);
            expect(slot.startStreaming()).toBe(true);
            return slot;
        });
        expect(budget.begin(vi.fn())).toBeNull();
        live[0]!.release();
        const replacement = budget.begin(vi.fn())!;
        expect(replacement.reserveUser('replacement')).toBe(true);
        expect(replacement.startStreaming()).toBe(true);
        for (const slot of live) slot.release();
        replacement.release();
    });
});
