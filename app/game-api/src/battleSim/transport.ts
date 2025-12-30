import type { BattleSimJobPayload, BattleSimResultPayload, BattleSimTransportResponse } from './types.js';

export interface BattleSimTransport {
    simulate(payload: BattleSimJobPayload): Promise<BattleSimTransportResponse>;
    getSimulationResult(jobId: string): Promise<BattleSimResultPayload | null>;
}
