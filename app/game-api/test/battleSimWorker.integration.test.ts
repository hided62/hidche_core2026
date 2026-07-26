import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { createRedisConnector, resolveRedisConfigFromEnv } from '@sammo-ts/infra';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildBattleSimEnvironment } from '../src/battleSim/environment.js';
import { buildBattleSimQueueKeys } from '../src/battleSim/keys.js';
import { RedisBattleSimTransport } from '../src/battleSim/redisTransport.js';
import type { BattleSimRequestPayload } from '../src/battleSim/types.js';
import { runBattleSimWorker } from '../src/battleSim/worker.js';
import type { WorldStateRow } from '../src/context.js';

const liveDescribe = process.env.REDIS_URL ? describe : describe.skip;

afterEach(() => {
    vi.unstubAllEnvs();
});

liveDescribe('battle simulator worker with live Redis', () => {
    it('consumes an isolated queue, produces a result, and stops cleanly', { timeout: 30_000 }, async () => {
        const scenario = `battle-sim-e2e-${randomUUID()}`;
        const profileName = `che:${scenario}`;
        const requesterUserId = 'worker-e2e-user';
        vi.stubEnv('PROFILE', 'che');
        vi.stubEnv('SCENARIO', scenario);
        vi.stubEnv('GAME_TOKEN_SECRET', 'battle-sim-test-only');

        const fixturePath = path.resolve(
            process.cwd(),
            '../../tools/integration-tests/fixtures/battle/basic-infantry.json'
        );
        const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8')) as BattleSimRequestPayload & {
            startYear: number;
        };
        const { startYear, ...request } = fixture;
        const worldState: WorldStateRow = {
            id: 1,
            scenarioCode: 'default',
            currentYear: request.year,
            currentMonth: request.month,
            tickSeconds: 600,
            config: {},
            meta: { scenarioMeta: { startYear } },
            updatedAt: new Date(),
        };
        const environment = await buildBattleSimEnvironment(worldState, 'che');
        const payload = {
            ...request,
            unitSet: environment.unitSet,
            config: environment.config,
            time: { year: request.year, month: request.month, startYear },
        };

        const clientConnector = createRedisConnector(resolveRedisConfigFromEnv());
        await clientConnector.connect();
        const keys = buildBattleSimQueueKeys(profileName);
        const transport = new RedisBattleSimTransport(clientConnector.client, {
            keys,
            requestTimeoutMs: 15_000,
            resultTtlSeconds: 60,
        });
        const abortController = new AbortController();
        const worker = runBattleSimWorker({ signal: abortController.signal });
        let jobId: string | null = null;

        try {
            const result = await transport.simulate(payload, requesterUserId);
            jobId = result.jobId;
            expect(result.status).toBe('completed');
            if (result.status === 'completed') {
                expect(result.payload).toMatchObject({
                    result: true,
                    reason: 'success',
                    avgWar: 1,
                });
                expect(result.payload.phase).toBeGreaterThan(0);
            }
        } finally {
            abortController.abort();
            await worker;
            if (jobId) {
                const encodedRequester = encodeURIComponent(requesterUserId);
                await clientConnector.client.del([
                    keys.queueKey,
                    `${keys.resultKeyPrefix}${encodedRequester}:${jobId}`,
                    `${keys.notifyKeyPrefix}${encodedRequester}:${jobId}`,
                ]);
            }
            await clientConnector.disconnect();
        }
    });
});
