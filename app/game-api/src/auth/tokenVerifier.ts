import type { GameSessionTokenPayload } from '@sammo-ts/common';
import { decryptGameSessionToken } from '@sammo-ts/common';
import { isAfter, isValid, parseISO } from 'date-fns';

import type { FlushStore } from './flushStore.js';

export interface GameTokenVerifier {
    verify(token: string): GameSessionTokenPayload | null;
}

const parseDate = (value: string): Date | null => {
    const parsed = parseISO(value);
    return isValid(parsed) ? parsed : null;
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
            if (isAfter(new Date(), expiresAt)) {
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
