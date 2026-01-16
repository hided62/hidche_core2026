import { defineStore } from 'pinia';
import { gatewayTrpc } from '../utils/gatewayTrpc';
import { trpc as gameTrpc } from '../utils/trpc';

export type SessionStatus = 'unknown' | 'public' | 'authed' | 'general';

export interface SessionUser {
    id: string;
    username: string;
    displayName: string;
}

interface SessionState {
    status: SessionStatus;
    user: SessionUser | null;
    sessionToken: string | null;
    gameToken: string | null;
    profile: string | null;
    initializing: boolean;
    error: string | null;
}

const SESSION_TOKEN_KEY = 'sammo-session-token';
const PROFILE_KEY = 'sammo-game-profile';
const GAME_TOKEN_KEY = 'sammo-game-token';
const ACCESS_TOKEN_PREFIX = 'ga_';

const readStorage = (key: string): string | null => {
    if (typeof window === 'undefined') {
        return null;
    }
    return window.localStorage.getItem(key);
};

const writeStorage = (key: string, value: string | null): void => {
    if (typeof window === 'undefined') {
        return;
    }
    if (value) {
        window.localStorage.setItem(key, value);
    } else {
        window.localStorage.removeItem(key);
    }
};

const readQueryParam = (key: string): string | null => {
    if (typeof window === 'undefined') {
        return null;
    }
    const url = new URL(window.location.href);
    const value = url.searchParams.get(key);
    if (!value) {
        return null;
    }
    url.searchParams.delete(key);
    window.history.replaceState({}, '', url.toString());
    return value;
};

const isAccessToken = (token: string | null): boolean => {
    if (!token) {
        return false;
    }
    return token.startsWith(ACCESS_TOKEN_PREFIX);
};

export const useSessionStore = defineStore('session', {
    state: (): SessionState => ({
        status: 'unknown',
        user: null,
        sessionToken: null,
        gameToken: null,
        profile: null,
        initializing: false,
        error: null,
    }),
    getters: {
        isReady: (state) => state.status !== 'unknown',
        isAuthed: (state) => state.status === 'authed' || state.status === 'general',
        hasGeneral: (state) => state.status === 'general',
        needsGeneral: (state) => state.status === 'authed',
    },
    actions: {
        setSessionToken(sessionToken: string | null) {
            this.sessionToken = sessionToken;
            writeStorage(SESSION_TOKEN_KEY, sessionToken);
        },
        setProfile(profile: string | null) {
            this.profile = profile;
            writeStorage(PROFILE_KEY, profile);
        },
        setGameToken(gameToken: string | null) {
            this.gameToken = gameToken;
            writeStorage(GAME_TOKEN_KEY, gameToken);
        },
        clearSession() {
            this.user = null;
            this.setSessionToken(null);
            this.setGameToken(null);
            this.status = 'public';
        },
        async refreshGeneralStatus() {
            if (!this.gameToken) {
                this.status = 'authed';
                return;
            }
            if (!isAccessToken(this.gameToken)) {
                const exchanged = await this.exchangeGatewayToken();
                if (!exchanged) {
                    this.status = this.sessionToken ? 'authed' : 'public';
                    return;
                }
            }
            try {
                const lobby = await gameTrpc.lobby.info.query();
                this.status = lobby.myGeneral ? 'general' : 'authed';
            } catch {
                this.error = 'game_status_unavailable';
            }
        },
        async exchangeGatewayToken(): Promise<boolean> {
            if (!this.gameToken || isAccessToken(this.gameToken)) {
                return true;
            }
            try {
                const exchanged = await gameTrpc.auth.exchangeGatewayToken.mutate({
                    gatewayToken: this.gameToken,
                });
                this.setGameToken(exchanged.accessToken);
                return true;
            } catch {
                this.error = 'game_token_exchange_failed';
                this.setGameToken(null);
                return false;
            }
        },
        async initialize() {
            if (this.initializing || this.status !== 'unknown') {
                return;
            }

            this.initializing = true;
            this.error = null;

            const tokenFromQuery = readQueryParam('sessionToken');
            if (tokenFromQuery) {
                this.setSessionToken(tokenFromQuery);
            }

            const profileFromQuery = readQueryParam('profile');
            if (profileFromQuery) {
                this.setProfile(profileFromQuery);
            }

            const gatewayTokenFromQuery = readQueryParam('gameToken');
            if (gatewayTokenFromQuery) {
                this.setGameToken(gatewayTokenFromQuery);
            }

            const storedToken = this.sessionToken ?? readStorage(SESSION_TOKEN_KEY);
            if (storedToken && storedToken !== this.sessionToken) {
                this.setSessionToken(storedToken);
            }

            const storedProfile = this.profile ?? readStorage(PROFILE_KEY) ?? import.meta.env.VITE_GAME_PROFILE;
            if (storedProfile && storedProfile !== this.profile) {
                this.setProfile(storedProfile);
            }

            if (!this.sessionToken && !this.gameToken) {
                this.status = 'public';
                this.initializing = false;
                return;
            }

            if (this.sessionToken) {
                try {
                    const me = await gatewayTrpc.me.query();
                    if (!me) {
                        this.clearSession();
                        this.initializing = false;
                        return;
                    }
                    this.user = {
                        id: me.id,
                        username: me.username,
                        displayName: me.displayName,
                    };
                    this.status = 'authed';
                } catch {
                    this.error = 'gateway_unavailable';
                    this.status = 'public';
                    this.initializing = false;
                    return;
                }
            } else {
                this.status = 'authed';
            }

            if (!this.profile) {
                this.initializing = false;
                return;
            }

            try {
                if (!this.gameToken || !isAccessToken(this.gameToken)) {
                    const sessionToken = this.sessionToken;
                    if (sessionToken) {
                        const issued = await gatewayTrpc.auth.issueGameSession.mutate({
                            sessionToken,
                            profile: this.profile,
                        });
                        this.setGameToken(issued.gameToken);
                    }
                }
                await this.refreshGeneralStatus();
            } catch {
                this.error = 'game_session_unavailable';
                this.status = 'authed';
            } finally {
                this.initializing = false;
            }
        },
    },
});
