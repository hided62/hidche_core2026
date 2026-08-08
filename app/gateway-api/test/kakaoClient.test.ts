import { afterEach, describe, expect, it, vi } from 'vitest';

import { KakaoOAuthClient } from '../src/auth/kakaoClient.js';

const createClient = (): KakaoOAuthClient =>
    new KakaoOAuthClient({
        restKey: 'rest-key',
        redirectUri: 'https://gateway.example.test/oauth/callback',
        apiHost: 'https://kapi.example.test',
    });

describe('Kakao OAuth HTTP transport', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('normalizes Kakao -102 already registered errors into an account recovery result', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
            new Response(JSON.stringify({ msg: 'already registered', code: -102 }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            })
        );

        await expect(createClient().signup('access-token')).resolves.toEqual({
            alreadyRegistered: true,
        });
        expect(fetchMock).toHaveBeenCalledWith(new URL('https://kapi.example.test/v1/user/signup'), {
            headers: {
                Authorization: 'Bearer access-token',
            },
        });
    });

    it('continues to reject unrelated Kakao signup errors', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
            new Response(JSON.stringify({ msg: 'invalid request', code: -201 }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            })
        );

        await expect(createClient().signup('access-token')).rejects.toThrow(
            'Kakao signup error: {"msg":"invalid request","code":-201}'
        );
    });
});
