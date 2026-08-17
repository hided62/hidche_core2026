import type { BattleSimJobPayload, BattleSimResultPayload } from '@sammo-ts/logic';

export interface BattleSimulatorWorkerRequest {
    requestId: number;
    payload: BattleSimJobPayload;
}

export type BattleSimulatorWorkerResponse =
    | {
          requestId: number;
          ok: true;
          result: BattleSimResultPayload;
      }
    | {
          requestId: number;
          ok: false;
          error: string;
      };
