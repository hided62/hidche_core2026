import { defineStore } from 'pinia';

export type SessionStatus = 'unknown' | 'public' | 'authed' | 'general';

interface SessionState {
    status: SessionStatus;
}

export const useSessionStore = defineStore('session', {
    state: (): SessionState => ({
        status: 'unknown',
    }),
    getters: {
        isReady: (state) => state.status !== 'unknown',
        isAuthed: (state) => state.status === 'authed' || state.status === 'general',
        hasGeneral: (state) => state.status === 'general',
    },
    actions: {
        setStatus(status: SessionStatus) {
            this.status = status;
        },
    },
});
