/// <reference lib="webworker" />

import type {
    BattleSimulatorWorkerRequest,
    BattleSimulatorWorkerResponse,
} from '../utils/battleSimulatorWorkerProtocol';

const workerScope: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

const loadProcessor = () => import('@sammo-ts/logic');
let processorPromise: ReturnType<typeof loadProcessor> | null = null;

workerScope.addEventListener('message', async (event: MessageEvent<BattleSimulatorWorkerRequest>) => {
    const { requestId, payload } = event.data;
    let response: BattleSimulatorWorkerResponse;
    try {
        processorPromise ??= loadProcessor();
        const { processBattleSimJob } = await processorPromise;
        response = {
            requestId,
            ok: true,
            result: processBattleSimJob(payload),
        };
    } catch (error) {
        response = {
            requestId,
            ok: false,
            error: error instanceof Error ? error.message : '전투 시뮬레이션 오류',
        };
    }
    workerScope.postMessage(response);
});
