import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runTournamentWorker } from '../src/tournament/worker.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const liveDescribe = databaseUrl && process.env.REDIS_URL ? describe : describe.skip;
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

liveDescribe('polling worker graceful shutdown', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('interrupts an idle tournament poll, tolerates repeated abort, and disposes signal listeners', async () => {
        const schema = new URL(databaseUrl!).searchParams.get('schema');
        if (!schema) throw new Error('integration database URL must include a schema');
        vi.stubEnv('DATABASE_URL', databaseUrl!);
        vi.stubEnv('PROFILE', schema);
        vi.stubEnv('SCENARIO', 'worker-shutdown');
        vi.stubEnv('GAME_PROFILE_NAME', `worker-shutdown:${randomUUID()}`);
        vi.stubEnv('GAME_TOKEN_SECRET', 'worker-shutdown-integration-only');
        vi.stubEnv('TOURNAMENT_POLL_MS', '60000');

        const sigintListeners = process.listenerCount('SIGINT');
        const sigtermListeners = process.listenerCount('SIGTERM');
        const abortController = new AbortController();
        const worker = runTournamentWorker({ signal: abortController.signal });
        await delay(100);

        abortController.abort();
        abortController.abort();
        await expect(worker).resolves.toBeUndefined();
        expect(process.listenerCount('SIGINT')).toBe(sigintListeners);
        expect(process.listenerCount('SIGTERM')).toBe(sigtermListeners);
    });
});
