import crypto from 'node:crypto';

import type { BattleSimJobPayload, BattleSimResultPayload, BattleSimTransportResponse } from './types.js';
import { processBattleSimJob } from './processor.js';

export class InMemoryBattleSimTransport {
    private readonly results = new Map<string, { requesterUserId: string; payload: BattleSimResultPayload }>();

    public async simulate(payload: BattleSimJobPayload, requesterUserId: string): Promise<BattleSimTransportResponse> {
        const jobId = crypto.randomUUID();
        const result = processBattleSimJob(payload);
        this.results.set(jobId, { requesterUserId, payload: result });
        return { status: 'completed', jobId, payload: result };
    }

    public async getSimulationResult(jobId: string, requesterUserId: string): Promise<BattleSimResultPayload | null> {
        const result = this.results.get(jobId);
        if (!result || result.requesterUserId !== requesterUserId) {
            return null;
        }
        return result.payload;
    }
}
