const DEFAULT_LIMITS = { connections: 512, perUser: 8, opening: 32 } as const;
const OPENING_DEADLINE_MS = 5000;

export interface RealtimeConnectionReservation {
    canContinue(): boolean;
    reserveUser(userId: string): boolean;
    startStreaming(): boolean;
    cancelOpening(): void;
    release(): void;
}

/** One game API process owns both pending setup and live streams; no waiting queue. */
export class RealtimeConnectionAdmission {
    private readonly limits: { connections: number; perUser: number; opening: number };
    private total = 0;
    private opening = 0;
    private closed = false;
    private readonly byUser = new Map<string, number>();
    private readonly pending = new Set<() => void>();

    constructor(limits: Partial<{ connections: number; perUser: number; opening: number }> = {}) {
        this.limits = { ...DEFAULT_LIMITS, ...limits };
        if (Object.values(this.limits).some((value) => !Number.isSafeInteger(value) || value < 1))
            throw new Error('Invalid realtime connection limits.');
    }

    begin(onTimeout: () => void): RealtimeConnectionReservation | null {
        if (this.closed || this.total >= this.limits.connections || this.opening >= this.limits.opening) return null;
        this.total += 1;
        this.opening += 1;
        let userId: string | null = null;
        let streaming = false;
        let cancelled = false;
        let released = false;
        const deadline = Date.now() + OPENING_DEADLINE_MS;
        const expire = () => {
            if (released || streaming || cancelled) return;
            cancelled = true;
            clearTimeout(timer);
            onTimeout();
        };
        const timer = setTimeout(expire, OPENING_DEADLINE_MS);
        timer.unref();
        this.pending.add(expire);
        const canContinue = () => {
            if (!released && !streaming && !cancelled && Date.now() >= deadline) expire();
            return !released && !streaming && !cancelled;
        };
        return {
            canContinue,
            reserveUser: (id) => {
                if (!canContinue() || userId !== null) return false;
                const count = this.byUser.get(id) ?? 0;
                if (count >= this.limits.perUser) return false;
                this.byUser.set(id, count + 1);
                userId = id;
                return true;
            },
            startStreaming: () => {
                if (!canContinue() || userId === null) return false;
                streaming = true;
                this.opening -= 1;
                clearTimeout(timer);
                this.pending.delete(expire);
                return true;
            },
            cancelOpening: () => {
                if (released || streaming) return;
                cancelled = true;
                clearTimeout(timer);
                // Disconnect/timeout does not prove the awaited Redis/SQL operation has settled.
            },
            release: () => {
                if (released) return;
                released = true;
                this.total -= 1;
                if (!streaming) this.opening -= 1;
                clearTimeout(timer);
                this.pending.delete(expire);
                if (userId !== null) {
                    const count = (this.byUser.get(userId) ?? 1) - 1;
                    if (count === 0) this.byUser.delete(userId);
                    else this.byUser.set(userId, count);
                }
            },
        };
    }

    close(): void {
        this.closed = true;
        for (const expire of this.pending) expire();
    }
}
