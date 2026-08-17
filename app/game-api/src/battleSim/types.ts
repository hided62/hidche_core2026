import type { BattleSimJobPayload, BattleSimResultPayload } from '@sammo-ts/logic';

export type {
    BattleSimAction,
    BattleSimCityPayload,
    BattleSimGeneralPayload,
    BattleSimJobPayload,
    BattleSimLogBuckets,
    BattleSimNationPayload,
    BattleSimRequestPayload,
    BattleSimResultPayload,
} from '@sammo-ts/logic';

export interface BattleSimJob {
    jobId: string;
    requesterUserId: string;
    requestedAt: string;
    payload: BattleSimJobPayload;
}

export interface BattleSimCompleted {
    status: 'completed';
    jobId: string;
    payload: BattleSimResultPayload;
}

export interface BattleSimQueued {
    status: 'queued';
    jobId: string;
}

export type BattleSimTransportResponse = BattleSimCompleted | BattleSimQueued;
