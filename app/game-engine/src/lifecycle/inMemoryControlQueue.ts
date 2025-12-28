import type { TurnDaemonCommand, TurnDaemonControlQueue } from './types.js';

type Waiter = {
    deadlineMs: number | null;
    resolve: (command: TurnDaemonCommand | null) => void;
    timeoutId?: ReturnType<typeof setTimeout>;
};

export class InMemoryControlQueue implements TurnDaemonControlQueue {
    // 단일 프로세스 내에서 쓰는 간단한 제어 큐.
    private queue: TurnDaemonCommand[] = [];
    private waiters: Waiter[] = [];

    enqueue(command: TurnDaemonCommand): void {
        const waiter = this.waiters.shift();
        if (waiter) {
            if (waiter.timeoutId) {
                clearTimeout(waiter.timeoutId);
            }
            waiter.resolve(command);
            return;
        }
        this.queue.push(command);
    }

    async drain(): Promise<TurnDaemonCommand[]> {
        if (this.queue.length === 0) {
            return [];
        }
        const drained = this.queue.slice();
        this.queue.length = 0;
        return drained;
    }

    async waitUntil(deadlineMs: number | null): Promise<TurnDaemonCommand | null> {
        if (this.queue.length > 0) {
            return this.queue.shift() ?? null;
        }
        return new Promise((resolve) => {
            const waiter: Waiter = { deadlineMs, resolve };
            if (deadlineMs !== null) {
                const delay = Math.max(0, deadlineMs - Date.now());
                waiter.timeoutId = setTimeout(() => {
                    this.removeWaiter(waiter);
                    resolve(null);
                }, delay);
            }
            this.waiters.push(waiter);
        });
    }

    getDepth(): number {
        return this.queue.length;
    }

    private removeWaiter(waiter: Waiter): void {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) {
            this.waiters.splice(index, 1);
        }
    }
}
