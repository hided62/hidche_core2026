import type { Clock } from './types.js';

export class SystemClock implements Clock {
    // 시스템 시간을 기준으로 동작하는 기본 시계.
    nowMs(): number {
        return Date.now();
    }

    async sleepMs(ms: number): Promise<void> {
        if (ms <= 0) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, ms));
    }
}
