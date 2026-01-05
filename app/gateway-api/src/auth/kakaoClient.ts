export interface KakaoOAuthConfig {
    restKey: string;
    adminKey?: string;
    redirectUri: string;
    oauthHost?: string;
    apiHost?: string;
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

    constructor(config: KakaoOAuthConfig) {
        this.restKey = config.restKey;
        this.redirectUri = config.redirectUri;
        this.oauthHost = config.oauthHost ?? 'https://kauth.kakao.com';
        this.apiHost = config.apiHost ?? 'https://kapi.kakao.com';
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
        const response = await fetch(new URL('/oauth/token', this.oauthHost), {
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
        const payload = (await response.json()) as Record<string, unknown>;
        if (!response.ok) {
            throw new Error(`Kakao OAuth token error: ${JSON.stringify(payload)}`);
        }
        return parseToken(payload);
    }

    async refreshToken(refreshToken: string): Promise<KakaoOAuthToken> {
        const response = await fetch(new URL('/oauth/token', this.oauthHost), {
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
        const payload = (await response.json()) as Record<string, unknown>;
        if (!response.ok) {
            throw new Error(`Kakao OAuth refresh error: ${JSON.stringify(payload)}`);
        }
        return parseToken(payload);
    }

    async signup(accessToken: string): Promise<{ id?: string; msg?: string }> {
        const response = await fetch(new URL('/v1/user/signup', this.apiHost), {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });
        const payload = (await response.json()) as Record<string, unknown>;
        if (!response.ok) {
            throw new Error(`Kakao signup error: ${JSON.stringify(payload)}`);
        }
        return {
            id: payload.id ? String(payload.id) : undefined,
            msg: payload.msg ? String(payload.msg) : undefined,
        };
    }

    async getMe(accessToken: string): Promise<KakaoUserInfo> {
        const response = await fetch(new URL('/v2/user/me', this.apiHost), {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });
        const payload = (await response.json()) as Record<string, unknown>;
        if (!response.ok) {
            throw new Error(`Kakao me error: ${JSON.stringify(payload)}`);
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
        const response = await fetch(new URL('/v2/api/talk/memo/default/send', this.apiHost), {
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
        const payload = (await response.json()) as Record<string, unknown>;
        const code = Number(payload.code ?? 0);
        if (!response.ok || code < 0) {
            throw new Error(`Kakao talk message error: ${JSON.stringify(payload)}`);
        }
    }
}
