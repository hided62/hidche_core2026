export interface Clock {
    nowMs(): number;
    sleepMs(ms: number): Promise<void>;
}

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

export class ManualClock implements Clock {
    // 테스트에서 시간을 직접 이동시키는 수동 시계.
    private currentMs: number;

    constructor(initialMs = 0) {
        this.currentMs = initialMs;
    }

    nowMs(): number {
        return this.currentMs;
    }

    async sleepMs(ms: number): Promise<void> {
        if (ms <= 0) {
            return;
        }
        this.currentMs += ms;
    }

    advanceMs(ms: number): void {
        if (ms <= 0) {
            return;
        }
        this.currentMs += ms;
    }

    setMs(ms: number): void {
        this.currentMs = ms;
    }
}

export class StepClock implements Clock {
    // 호출마다 일정 간격씩 시간이 진행되는 시계.
    private currentMs: number;
    private readonly stepMs: number;

    constructor(stepMs: number, initialMs = 0) {
        if (stepMs <= 0) {
            throw new Error('stepMs must be positive');
        }
        this.stepMs = stepMs;
        this.currentMs = initialMs;
    }

    nowMs(): number {
        this.currentMs += this.stepMs;
        return this.currentMs;
    }

    async sleepMs(ms: number): Promise<void> {
        if (ms <= 0) {
            return;
        }
        this.currentMs += ms;
    }

    advanceMs(ms: number): void {
        if (ms <= 0) {
            return;
        }
        this.currentMs += ms;
    }

    setMs(ms: number): void {
        this.currentMs = ms;
    }
}
