import type { BattleSimJobPayload, BattleSimResultPayload } from '@sammo-ts/logic';

import type { BattleSimulatorWorkerRequest, BattleSimulatorWorkerResponse } from './battleSimulatorWorkerProtocol';

type PendingRequest = {
    resolve: (result: BattleSimResultPayload) => void;
    reject: (error: Error) => void;
};

export class BattleSimulatorWorkerClient {
    private worker: Worker | null = null;
    private nextRequestId = 1;
    private readonly pending = new Map<number, PendingRequest>();

    private ensureWorker(): Worker {
        if (this.worker) {
            return this.worker;
        }

        const worker = new Worker(new URL('../workers/battleSimulator.worker.ts', import.meta.url), {
            type: 'module',
            name: 'sammo-battle-simulator',
        });
        worker.addEventListener('message', this.handleMessage);
        worker.addEventListener('error', this.handleWorkerError);
        this.worker = worker;
        return worker;
    }

    private readonly handleMessage = (event: MessageEvent<BattleSimulatorWorkerResponse>): void => {
        const pending = this.pending.get(event.data.requestId);
        if (!pending) {
            return;
        }
        this.pending.delete(event.data.requestId);
        if (event.data.ok) {
            pending.resolve(event.data.result);
            return;
        }
        pending.reject(new Error(event.data.error));
    };

    private readonly handleWorkerError = (event: ErrorEvent): void => {
        const error = new Error(event.message || '전투 시뮬레이션 worker 오류');
        for (const pending of this.pending.values()) {
            pending.reject(error);
        }
        this.pending.clear();
        this.disposeWorker();
    };

    public run(payload: BattleSimJobPayload): Promise<BattleSimResultPayload> {
        const requestId = this.nextRequestId;
        this.nextRequestId += 1;
        const request: BattleSimulatorWorkerRequest = { requestId, payload };
        const promise = new Promise<BattleSimResultPayload>((resolve, reject) => {
            this.pending.set(requestId, { resolve, reject });
        });
        this.ensureWorker().postMessage(request);
        return promise;
    }

    private disposeWorker(): void {
        if (!this.worker) {
            return;
        }
        this.worker.removeEventListener('message', this.handleMessage);
        this.worker.removeEventListener('error', this.handleWorkerError);
        this.worker.terminate();
        this.worker = null;
    }

    public dispose(): void {
        const error = new Error('전투 시뮬레이션이 취소되었습니다.');
        for (const pending of this.pending.values()) {
            pending.reject(error);
        }
        this.pending.clear();
        this.disposeWorker();
    }
}
