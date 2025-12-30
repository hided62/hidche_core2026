import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken.js';
import { decryptGameSessionToken } from '@sammo-ts/common/auth/gameToken.js';

import type { FlushStore } from './flushStore.js';

export interface GameTokenVerifier {
    verify(token: string): GameSessionTokenPayload | null;
}

const parseDate = (value: string): Date | null => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    return parsed;
};

export const createGameTokenVerifier = (options: {
    secret: string;
    profileName: string;
    flushStore: FlushStore;
}): GameTokenVerifier => {
    return {
        verify: (token: string): GameSessionTokenPayload | null => {
            const payload = decryptGameSessionToken(token, options.secret);
            if (!payload) {
                return null;
            }
            if (payload.profile !== options.profileName) {
                return null;
            }
            const expiresAt = parseDate(payload.expiresAt);
            const issuedAt = parseDate(payload.issuedAt);
            if (!expiresAt || !issuedAt) {
                return null;
            }
            if (Date.now() > expiresAt.getTime()) {
                return null;
            }
            const flushedAt = options.flushStore.getFlushedAt(payload.user.id);
            if (flushedAt && issuedAt <= flushedAt) {
                return null;
            }
            return payload;
        },
    };
};
