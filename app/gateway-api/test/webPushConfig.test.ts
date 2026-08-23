import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveGatewayApiConfigFromEnv } from '../src/config.js';

const requiredEnv = {
    GAME_TOKEN_SECRET: 'test-game-token-secret',
    KAKAO_REST_KEY: 'test-kakao-key',
    KAKAO_REDIRECT_URI: 'https://gateway.test.invalid/gateway/oauth/callback',
};

const tempDirectories: string[] = [];

afterEach(() => {
    for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('resolveGatewayApiConfigFromEnv web push', () => {
    it('stays disabled without reading a configured private-key file', () => {
        const config = resolveGatewayApiConfigFromEnv({
            ...requiredEnv,
            WEB_PUSH_ENABLED: 'false',
            WEB_PUSH_VAPID_PRIVATE_KEY_FILE: '/does/not/exist',
        });

        expect(config.webPushEnabled).toBe(false);
        expect(config.webPushVapidPrivateKey).toBeUndefined();
    });

    it('reads the VAPID private key from a file only when enabled', () => {
        const directory = mkdtempSync(path.join(tmpdir(), 'sammo-web-push-config-'));
        tempDirectories.push(directory);
        const privateKeyFile = path.join(directory, 'vapid-private-key');
        writeFileSync(privateKeyFile, 'test-private-key\n', { mode: 0o600 });

        const config = resolveGatewayApiConfigFromEnv({
            ...requiredEnv,
            WEB_PUSH_ENABLED: 'true',
            WEB_PUSH_VAPID_SUBJECT: 'mailto:admin@test.invalid',
            WEB_PUSH_VAPID_PUBLIC_KEY: 'test-public-key',
            WEB_PUSH_VAPID_PRIVATE_KEY_FILE: privateKeyFile,
        });

        expect(config.webPushEnabled).toBe(true);
        expect(config.webPushVapidPrivateKey).toBe('test-private-key');
    });

    it('fails closed when activation is incomplete', () => {
        expect(() =>
            resolveGatewayApiConfigFromEnv({
                ...requiredEnv,
                WEB_PUSH_ENABLED: 'true',
            })
        ).toThrow(/WEB_PUSH_ENABLED requires/u);
    });
});
