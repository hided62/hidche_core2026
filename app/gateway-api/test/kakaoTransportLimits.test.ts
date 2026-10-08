import { createServer, type Server, type ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { KakaoOAuthClient } from '../src/auth/kakaoClient.js';

describe('bounded Kakao provider transport', () => {
    const servers: Server[] = [];
    afterEach(async () => {
        for (const server of servers.splice(0)) {
            server.closeAllConnections();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });
    const provider = async (respond: (response: ServerResponse) => void, requestTimeoutMs = 1000) => {
        const server = createServer((_request, response) => respond(response));
        servers.push(server);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Fixture provider listener failed.');
        const origin = `http://127.0.0.1:${address.port}`;
        return new KakaoOAuthClient({
            restKey: 'synthetic-key',
            redirectUri: `${origin}/callback`,
            apiHost: origin,
            oauthHost: origin,
            requestTimeoutMs,
        });
    };

    it('retains successful token/account responses and documented recovery responses', async () => {
        const client = await provider((res) =>
            res.end(
                JSON.stringify({
                    id: 42,
                    access_token: 'synthetic-token',
                    expires_in: 3600,
                    kakao_account: {
                        has_email: true,
                        email: 'fixture@example.test',
                        is_email_valid: true,
                        is_email_verified: true,
                    },
                })
            )
        );
        expect(await client.exchangeCode('synthetic-code')).toMatchObject({
            accessToken: 'synthetic-token',
            accessTokenExpiresIn: 3600,
        });
        expect(await client.getMe('synthetic-token')).toMatchObject({
            id: '42',
            kakaoAccount: { email: 'fixture@example.test', isEmailVerified: true },
        });
    });

    it('aborts both header and response-body stalls within the configured deadline', async () => {
        const silent = await provider(() => {}, 100);
        await expect(silent.getMe('synthetic-token')).rejects.toThrow('Kakao HTTP request failed.');
        const partial = await provider((res) => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.write('{');
        }, 100);
        await expect(partial.getMe('synthetic-token')).rejects.toThrow('Kakao HTTP request failed.');
    });

    it('limits decompressed response bytes and rejects malformed JSON without exposing payloads', async () => {
        const oversized = await provider((res) => {
            res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
            res.end(gzipSync(JSON.stringify({ payload: 'x'.repeat(2 * 1024 * 1024) })));
        });
        await expect(oversized.getMe('synthetic-token')).rejects.toThrow('Kakao HTTP request failed.');
        const malformed = await provider((res) => res.end('synthetic-sensitive-provider-data'));
        await expect(malformed.getMe('synthetic-token')).rejects.toThrow('Kakao HTTP request failed.');
    });

    it('does not follow redirects or expose provider error details', async () => {
        let destinationRequests = 0;
        const destination = await provider((res) => {
            destinationRequests += 1;
            res.end('{}');
        });
        const destinationUrl = new URL(destination.buildAuthUrl('state', []));
        const redirect = await provider((res) => {
            res.writeHead(302, { location: destinationUrl.origin });
            res.end();
        });
        await expect(redirect.getMe('synthetic-token')).rejects.toThrow('Kakao HTTP request failed.');
        expect(destinationRequests).toBe(0);
        const failure = await provider((res) => {
            res.writeHead(400);
            res.end(JSON.stringify({ msg: 'synthetic-provider-secret', code: -201 }));
        });
        await expect(failure.signup('synthetic-token')).rejects.toThrow('Kakao signup error.');
    });
});
