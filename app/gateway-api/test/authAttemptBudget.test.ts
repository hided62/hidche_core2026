import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthAttemptBudget, AuthBudgetError, InMemoryAuthCounterStore } from '../src/auth/attemptBudget.js';

describe('authentication attempt and resource budgets', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('shares a login subject across clients without exposing account or address in keys', async () => {
        const store = new InMemoryAuthCounterStore();
        const consume = vi.spyOn(store, 'consume');
        const budget = new AuthAttemptBudget(store, 'fixture', 'fixture-secret');
        for (let i = 0; i < 10; i++)
            await budget.run('auth.login', `client-${i}`, 'login:fixture-user', async () => 'ok');
        const work = vi.fn(async () => 'must not run');
        await expect(budget.run('auth.login', 'another-client', 'login:fixture-user', work)).rejects.toMatchObject({
            reason: 'limited',
            retryAfterSeconds: 60,
        });
        expect(work).not.toHaveBeenCalled();
        expect(JSON.stringify(consume.mock.calls)).not.toContain('fixture-user');
        expect(JSON.stringify(consume.mock.calls)).not.toContain('client-');
        await expect(budget.run('auth.login', 'another-client', 'login:other-user', async () => 'ok')).resolves.toBe(
            'ok'
        );
    });

    it('does not extend a blocked account window and admits it after expiry', async () => {
        vi.useFakeTimers();
        const budget = new AuthAttemptBudget(new InMemoryAuthCounterStore(), 'fixture', 'secret');
        for (let i = 0; i < 10; i++) await budget.run('auth.login', 'client', 'login:user', async () => null);
        await vi.advanceTimersByTimeAsync(59_000);
        await expect(budget.run('auth.login', 'client', 'login:user', async () => null)).rejects.toMatchObject({
            retryAfterSeconds: 1,
        });
        await vi.advanceTimersByTimeAsync(1000);
        await expect(budget.run('auth.login', 'client', 'login:user', async () => 'recovered')).resolves.toBe(
            'recovered'
        );
    });

    it('limits public auth traffic per peer and across peers without charging rejected requests', async () => {
        const budget = new AuthAttemptBudget(new InMemoryAuthCounterStore(), 'fixture', 'secret');
        for (let i = 0; i < 600; i++) await budget.run('auth.passwordKey', 'peer-a', undefined, async () => null);
        await expect(budget.run('auth.kakaoStart', 'peer-a', undefined, async () => null)).rejects.toMatchObject({
            reason: 'limited',
        });
        for (let i = 0; i < 600; i++) await budget.run('auth.passwordKey', 'peer-b', undefined, async () => null);
        await expect(budget.run('auth.kakaoStart', 'peer-c', undefined, async () => null)).rejects.toMatchObject({
            reason: 'limited',
        });
    });

    it('bounds expensive work and releases capacity after resolver failures', async () => {
        const budget = new AuthAttemptBudget(new InMemoryAuthCounterStore(), 'fixture', 'secret');
        let release!: () => void;
        const pending = new Promise<void>((resolve) => {
            release = resolve;
        });
        const work = vi.fn(async () => {
            await pending;
            throw new Error('fixture resolver failure');
        });
        const running = Array.from({ length: 4 }, () =>
            budget.run('auth.login', 'client', undefined, work).catch(() => null)
        );
        await vi.waitFor(() => expect(work).toHaveBeenCalledTimes(4));
        const rejected = vi.fn(async () => null);
        await expect(budget.run('auth.registerLocal', 'client', undefined, rejected)).rejects.toBeInstanceOf(
            AuthBudgetError
        );
        expect(rejected).not.toHaveBeenCalled();
        release();
        await Promise.all(running);
        await expect(budget.run('auth.login', 'client', undefined, async () => 'ok')).resolves.toBe('ok');
    });

    it('bounds unfinished checks after caller timeouts and recovers only after they settle', async () => {
        vi.useFakeTimers();
        let release!: (retry: number) => void;
        const waiting = new Promise<number>((resolve) => {
            release = resolve;
        });
        const store = { consume: vi.fn(() => waiting) };
        const budget = new AuthAttemptBudget(store, 'fixture', 'secret');
        const work = vi.fn(async () => 'ok');
        const requests = Array.from({ length: 32 }, () =>
            budget.run('auth.passwordKey', 'client', undefined, work).catch((error: unknown) => error)
        );
        await vi.advanceTimersByTimeAsync(2001);
        expect(
            (await Promise.all(requests)).every(
                (error) => error instanceof AuthBudgetError && error.reason === 'unavailable'
            )
        ).toBe(true);
        const actorLookup = vi.fn(async () => undefined);
        await expect(budget.run('auth.login', 'client', actorLookup, work)).rejects.toMatchObject({
            reason: 'unavailable',
        });
        expect(actorLookup).not.toHaveBeenCalled();
        expect(work).not.toHaveBeenCalled();
        expect(store.consume).toHaveBeenCalledTimes(32);
        release(0);
        await Promise.resolve();
        await Promise.resolve();
        await expect(budget.run('auth.login', 'client', undefined, work)).resolves.toBe('ok');
        expect(work).toHaveBeenCalledTimes(1);
    });

    it('fails closed before credential work when the counter backend errors or stalls', async () => {
        const work = vi.fn(async () => null);
        const failing = new AuthAttemptBudget(
            {
                consume: async () => {
                    throw new Error('private-backend-error');
                },
            },
            'fixture',
            'secret'
        );
        await expect(failing.run('auth.login', 'client', undefined, work)).rejects.toMatchObject({
            reason: 'unavailable',
        });
        vi.useFakeTimers();
        const stalled = new AuthAttemptBudget({ consume: () => new Promise(() => {}) }, 'fixture', 'secret');
        const result = stalled.run('auth.login', 'client', undefined, work).catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(2001);
        expect(await result).toMatchObject({ reason: 'unavailable' });
        expect(work).not.toHaveBeenCalled();
    });
});
