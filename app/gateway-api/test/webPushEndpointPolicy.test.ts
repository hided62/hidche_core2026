import { createServer, request, Agent } from 'node:https';
import type { LookupAddress, LookupOptions } from 'node:dns';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';

import {
    createPublicPushLookup,
    isPublicPushAddress,
    parsePushEndpoint,
    PushEndpointPolicyError,
    resolvePublicPushAddresses,
} from '../src/webPush/endpointPolicy.js';

describe('Web Push outbound destination policy', () => {
    it.each([
        '127.0.0.1',
        '0.0.0.0',
        '10.0.0.1',
        '172.16.0.1',
        '192.168.1.1',
        '169.254.169.254',
        '100.64.0.1',
        '192.0.2.1',
        '198.18.0.1',
        '224.0.0.1',
        '255.255.255.255',
        '::1',
        '::',
        'fc00::1',
        'fe80::1',
        'ff02::1',
        '2001:db8::1',
        '::ffff:127.0.0.1',
        '64:ff9b::a00:1',
        '2002:0a00:0001::1',
        'not-an-ip',
    ])('rejects non-public address %s', (address) => {
        expect(isPublicPushAddress(address)).toBe(false);
    });

    it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('accepts public address %s', (address) => {
        expect(isPublicPushAddress(address)).toBe(true);
    });

    it.each([
        'http://push.example/subscription',
        'https://push.example:8443/subscription',
        'https://user:password@push.example/subscription',
        'https://push.example/subscription#secret',
        'https://127.0.0.1/subscription',
        'https://2130706433/subscription',
        'https://0x7f000001/subscription',
        'https://[::1]/subscription',
        'https://[::ffff:127.0.0.1]/subscription',
        'not-a-url',
    ])('rejects endpoint %s without DNS or network I/O', (endpoint) => {
        expect(() => parsePushEndpoint(endpoint)).toThrow(PushEndpointPolicyError);
    });

    it('preserves provider capability paths and query parameters', () => {
        const endpoint = 'https://fcm.googleapis.com:443/fcm/send/synthetic-capability?version=1';
        expect(parsePushEndpoint(endpoint).hostname).toBe('fcm.googleapis.com');
        expect(parsePushEndpoint(endpoint).search).toBe('?version=1');
    });

    it('rejects mixed public/private answers, empty answers and resolution errors without leaking values', async () => {
        for (const addresses of [
            [],
            [
                { address: '8.8.8.8', family: 4 },
                { address: '10.0.0.1', family: 4 },
            ],
        ]) {
            await expect(resolvePublicPushAddresses('push.example', async () => addresses)).rejects.toThrow(
                PushEndpointPolicyError
            );
        }
        await expect(
            resolvePublicPushAddresses('push.example', async () => {
                throw new Error('sensitive resolver details');
            })
        ).rejects.toThrow('Push endpoint resolution failed.');
    });

    it('returns only the validated DNS answer to the socket and respects family/all', async () => {
        const resolver = vi.fn(async () => [
            { address: '8.8.8.8', family: 4 },
            { address: '2606:4700:4700::1111', family: 6 },
        ]);
        const lookup = createPublicPushLookup(resolver);
        const runLookup = (options: LookupOptions) =>
            new Promise<string | LookupAddress[]>((resolve, reject) => {
                lookup('push.example', options, (error, address) => (error ? reject(error) : resolve(address)));
            });
        await expect(runLookup({ family: 6 })).resolves.toBe('2606:4700:4700::1111');
        await expect(runLookup({ all: true, family: 4 })).resolves.toEqual([{ address: '8.8.8.8', family: 4 }]);
        expect(resolver).toHaveBeenCalledTimes(2);
    });

    it('blocks a rebound hostname at the actual HTTPS socket before contacting a local listener', async () => {
        let connections = 0;
        const server = createServer();
        server.on('connection', () => {
            connections += 1;
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const port = (server.address() as AddressInfo).port;
        const resolver = vi
            .fn()
            .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
            .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
        const agent = new Agent({ lookup: createPublicPushLookup(resolver) });
        try {
            await resolvePublicPushAddresses('push.example', resolver);
            const failure = await new Promise<Error>((resolve, reject) => {
                const req = request({ hostname: 'push.example', port, agent, timeout: 1_000 }, () =>
                    reject(new Error('Unexpected connection'))
                );
                req.on('error', resolve);
                req.on('timeout', () => req.destroy(new Error('Unexpected timeout')));
                req.end();
            });
            expect(failure).toBeInstanceOf(PushEndpointPolicyError);
            expect(connections).toBe(0);
            expect(resolver).toHaveBeenCalledTimes(2);
        } finally {
            agent.destroy();
            await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        }
    });
});
