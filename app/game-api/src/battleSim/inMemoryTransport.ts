import crypto from 'node:crypto';

import type { BattleSimJobPayload, BattleSimResultPayload, BattleSimTransportResponse } from './types.js';
import { processBattleSimJob } from './processor.js';

export class InMemoryBattleSimTransport {
    private readonly results = new Map<string, BattleSimResultPayload>();

    public async simulate(payload: BattleSimJobPayload): Promise<BattleSimTransportResponse> {
        const jobId = crypto.randomUUID();
        const result = processBattleSimJob(payload);
        this.results.set(jobId, result);
        return { status: 'completed', jobId, payload: result };
    }

    public async getSimulationResult(jobId: string): Promise<BattleSimResultPayload | null> {
        return this.results.get(jobId) ?? null;
    }
}
