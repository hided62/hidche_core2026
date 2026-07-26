import type { BattleSimJobPayload, BattleSimResultPayload, BattleSimTransportResponse } from './types.js';

export interface BattleSimTransport {
    simulate(payload: BattleSimJobPayload, requesterUserId: string): Promise<BattleSimTransportResponse>;
    getSimulationResult(jobId: string, requesterUserId: string): Promise<BattleSimResultPayload | null>;
}
