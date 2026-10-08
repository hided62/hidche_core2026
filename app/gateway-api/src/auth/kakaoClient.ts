export interface KakaoOAuthConfig {
    restKey: string;
    adminKey?: string;
    redirectUri: string;
    oauthHost?: string;
    apiHost?: string;
    requestTimeoutMs?: number;
}

export interface KakaoOAuthToken {
    accessToken: string;
    refreshToken?: string;
    accessTokenExpiresIn: number;
    refreshTokenExpiresIn?: number;
}

export interface KakaoAccountInfo {
    hasEmail: boolean;
    email?: string;
    isEmailValid?: boolean;
    isEmailVerified?: boolean;
}

export interface KakaoUserInfo {
    id: string;
    kakaoAccount: KakaoAccountInfo;
}

export interface KakaoSignupResult {
    id?: string;
    alreadyRegistered: boolean;
}

const buildForm = (params: Record<string, string>): URLSearchParams => {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        form.append(key, value);
    }
    return form;
};

const parseToken = (payload: Record<string, unknown>): KakaoOAuthToken => {
    return {
        accessToken: String(payload.access_token ?? ''),
        refreshToken: payload.refresh_token ? String(payload.refresh_token) : undefined,
        accessTokenExpiresIn: Number(payload.expires_in ?? 0),
        refreshTokenExpiresIn: payload.refresh_token_expires_in ? Number(payload.refresh_token_expires_in) : undefined,
    };
};

export class KakaoOAuthClient {
    private readonly restKey: string;
    private readonly redirectUri: string;
    private readonly oauthHost: string;
    private readonly apiHost: string;
    private readonly requestTimeoutMs: number;

    constructor(config: KakaoOAuthConfig) {
        this.restKey = config.restKey;
        this.redirectUri = config.redirectUri;
        this.oauthHost = config.oauthHost ?? 'https://kauth.kakao.com';
        this.apiHost = config.apiHost ?? 'https://kapi.kakao.com';
        this.requestTimeoutMs = config.requestTimeoutMs ?? 10_000;
        if (!Number.isInteger(this.requestTimeoutMs) || this.requestTimeoutMs < 50 || this.requestTimeoutMs > 10_000) {
            throw new Error('Kakao request timeout must be between 50 and 10000 milliseconds.');
        }
    }

    private async requestJson(
        url: URL,
        init: RequestInit
    ): Promise<{ response: Response; payload: Record<string, unknown> }> {
        try {
            const response = await fetch(url, {
                ...init,
                redirect: 'error',
                signal: AbortSignal.timeout(this.requestTimeoutMs),
            });
            if (!response.body) throw new Error('Missing response body.');
            const reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            let bytes = 0;
            try {
                while (true) {
                    const chunk = await reader.read();
                    if (chunk.done) break;
                    bytes += chunk.value.byteLength;
                    if (bytes > 64 * 1024) {
                        void reader.cancel().catch(() => undefined);
                        throw new Error('Response is too large.');
                    }
                    chunks.push(chunk.value);
                }
            } finally {
                reader.releaseLock();
            }
            const payload: unknown = JSON.parse(
                new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
            );
            if (!payload || typeof payload !== 'object' || Array.isArray(payload))
                throw new Error('Invalid response shape.');
            return { response, payload: payload as Record<string, unknown> };
        } catch {
            // Provider/network payloads can include access tokens or account details.
            throw new Error('Kakao HTTP request failed.');
        }
    }

    buildAuthUrl(state: string, scopes: string[]): string {
        const base = new URL('/oauth/authorize', this.oauthHost);
        base.searchParams.set('client_id', this.restKey);
        base.searchParams.set('redirect_uri', this.redirectUri);
        base.searchParams.set('response_type', 'code');
        base.searchParams.set('state', state);
        if (scopes.length > 0) {
            base.searchParams.set('scope', scopes.join(','));
        }
        return base.toString();
    }

    async exchangeCode(code: string): Promise<KakaoOAuthToken> {
        const { response, payload } = await this.requestJson(new URL('/oauth/token', this.oauthHost), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: buildForm({
                grant_type: 'authorization_code',
                client_id: this.restKey,
                redirect_uri: this.redirectUri,
                code,
            }),
        });
        if (!response.ok) {
            throw new Error('Kakao OAuth token error.');
        }
        return parseToken(payload);
    }

    async refreshToken(refreshToken: string): Promise<KakaoOAuthToken> {
        const { response, payload } = await this.requestJson(new URL('/oauth/token', this.oauthHost), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: buildForm({
                grant_type: 'refresh_token',
                client_id: this.restKey,
                refresh_token: refreshToken,
            }),
        });
        if (!response.ok) {
            throw new Error('Kakao OAuth refresh error.');
        }
        return parseToken(payload);
    }

    async signup(accessToken: string): Promise<KakaoSignupResult> {
        const { response, payload } = await this.requestJson(new URL('/v1/user/signup', this.apiHost), {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });
        if (!response.ok && payload.code === -102 && payload.msg === 'already registered') {
            return {
                alreadyRegistered: true,
            };
        }
        if (!response.ok) {
            throw new Error('Kakao signup error.');
        }
        return {
            id: payload.id ? String(payload.id) : undefined,
            alreadyRegistered: false,
        };
    }

    async getMe(accessToken: string): Promise<KakaoUserInfo> {
        const { response, payload } = await this.requestJson(new URL('/v2/user/me', this.apiHost), {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });
        if (!response.ok) {
            throw new Error('Kakao me error.');
        }
        const kakaoAccount = (payload.kakao_account ?? {}) as Record<string, unknown>;
        return {
            id: String(payload.id ?? ''),
            kakaoAccount: {
                hasEmail: Boolean(kakaoAccount.has_email ?? false),
                email: kakaoAccount.email ? String(kakaoAccount.email) : undefined,
                isEmailValid: kakaoAccount.is_email_valid ? Boolean(kakaoAccount.is_email_valid) : undefined,
                isEmailVerified: kakaoAccount.is_email_verified ? Boolean(kakaoAccount.is_email_verified) : undefined,
            },
        };
    }

    async sendTalkMessage(accessToken: string, message: string, link: string): Promise<void> {
        const { response, payload } = await this.requestJson(new URL('/v2/api/talk/memo/default/send', this.apiHost), {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: buildForm({
                template_object: JSON.stringify({
                    object_type: 'text',
                    text: message,
                    link: {
                        web_url: link,
                        mobile_web_url: link,
                    },
                    button_title: '로그인 페이지 열기',
                }),
            }),
        });
        const code = Number(payload.code ?? 0);
        if (!response.ok || code < 0) {
            throw new Error('Kakao talk message error.');
        }
    }
}
