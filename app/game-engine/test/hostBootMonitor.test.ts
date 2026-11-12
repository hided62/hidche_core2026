import { createHmac, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHostBootMonitor, loadHostBootMonitor } from '../src/turn/hostBootMonitor.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const fixture = async () => {
    const key = randomBytes(32);
    let bootId = 'a'.repeat(64);
    let replay: string | null = null;
    let mode: 'valid' | 'replay' | 'forged' | 'oversized' | 'offline' | 'hang' = 'valid';
    const requests: string[] = [];
    const server = createServer((request, response) => {
        const nonce = String(request.headers['x-sammo-challenge']);
        requests.push(nonce);
        expect(request.headers['x-sammo-signature']).toBe(
            createHmac('sha256', key).update(`sammo-host-boot-request-v1\n${nonce}`).digest('hex')
        );
        if (mode === 'hang') return;
        if (mode === 'offline') {
            response.writeHead(503).end();
            return;
        }
        if (mode === 'oversized') {
            response.end('x'.repeat(4096));
            return;
        }
        if (mode === 'replay') {
            response.end(replay);
            return;
        }
        const body = JSON.stringify({
            version: 1,
            challenge: nonce,
            bootId,
            signature:
                mode === 'forged'
                    ? '0'.repeat(64)
                    : createHmac('sha256', key)
                          .update(`sammo-host-boot-response-v1\n${nonce}\n${bootId}`)
                          .digest('hex'),
        });
        replay ??= body;
        response.end(body);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    cleanups.push(
        () =>
            new Promise<void>((resolve) => {
                server.close(() => resolve());
                server.closeAllConnections();
            })
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture listener');
    return {
        key,
        requests,
        url: `http://127.0.0.1:${address.port}/v1/boot-id`,
        setBoot: (value: string) => {
            bootId = value;
        },
        setMode: (value: typeof mode) => {
            mode = value;
        },
    };
};

describe('Windows boot observation', () => {
    it('uses a stable baseline, survives outages, and latches a signed boot change', async () => {
        const f = await fixture();
        const monitor = createHostBootMonitor({ ...f, pollMs: 0 });
        expect(await monitor.hasChanged()).toBe(false);
        f.setMode('offline');
        expect(await monitor.hasChanged()).toBe(false);
        f.setBoot('b'.repeat(64));
        f.setMode('valid');
        expect(await monitor.hasChanged()).toBe(true);
        f.setMode('offline');
        expect(await monitor.hasChanged()).toBe(true);
    });

    it.each(['replay', 'forged', 'oversized', 'hang'] as const)(
        'rejects %s without changing the baseline',
        async (mode) => {
            const f = await fixture();
            const onUnavailable = vi.fn();
            const monitor = createHostBootMonitor({ ...f, pollMs: 0, timeoutMs: 100, onUnavailable });
            expect(await monitor.hasChanged()).toBe(false);
            f.setBoot('b'.repeat(64));
            f.setMode(mode);
            expect(await monitor.hasChanged()).toBe(false);
            expect(onUnavailable).toHaveBeenCalledOnce();
            f.setMode('valid');
            expect(await monitor.hasChanged()).toBe(true);
        }
    );

    it('samples immediately after a wall-clock jump despite a frozen monotonic cache and coalesces requests', async () => {
        const f = await fixture();
        let wall = 10_000;
        const monitor = createHostBootMonitor({ ...f, now: () => 0, wallNow: () => wall });
        expect(await monitor.hasChanged()).toBe(false);
        expect(await monitor.hasChanged()).toBe(false);
        expect(f.requests).toHaveLength(1);
        wall += 300_000;
        f.setBoot('b'.repeat(64));
        expect(await Promise.all([monitor.hasChanged(), monitor.hasChanged()])).toEqual([true, true]);
        expect(f.requests).toHaveLength(2);
        expect(new Set(f.requests).size).toBe(2);
    });

    it('does not block game startup when optional configuration or its key file is absent', async () => {
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(await loadHostBootMonitor({})).toBeUndefined();
        expect(await loadHostBootMonitor({ TURN_HOST_BOOT_URL: 'http://host/v1/boot-id' })).toBeUndefined();
        expect(
            await loadHostBootMonitor({
                TURN_HOST_BOOT_URL: 'http://host/v1/boot-id',
                TURN_HOST_BOOT_KEY_FILE: '/nonexistent-host-boot-key',
            })
        ).toBeUndefined();
        expect(() =>
            createHostBootMonitor({ url: 'http://user:password@host/v1/boot-id', key: randomBytes(32) })
        ).toThrow('without credentials');
        warning.mockRestore();
    });
});
