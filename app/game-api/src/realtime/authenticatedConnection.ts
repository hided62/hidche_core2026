import type { ServerResponse } from 'node:http';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';

const MAX_PENDING_FRAMES = 32;
const MAX_BUFFER_BYTES = 64 * 1024;

/** Revalidate before work and before writing its result; never retain unbounded frames. */
export class AuthenticatedRealtimeConnection {
    private queue = Promise.resolve();
    private pending = 0;
    private ended = false;
    private readonly expiryTimer: ReturnType<typeof setTimeout>;
    private cleanup = new Set<() => void>();

    constructor(
        readonly auth: GameSessionTokenPayload,
        private readonly response: ServerResponse,
        private readonly resolveAuth: () => Promise<GameSessionTokenPayload | null>
    ) {
        // AccessTokenStore requires a full remaining TTL second on every lookup.
        this.expiryTimer = setTimeout(() => this.close(), Math.max(0, Date.parse(auth.expiresAt) - Date.now() - 999));
        this.expiryTimer.unref();
        response.once('close', this.close);
        response.once('error', this.close);
    }

    get closed(): boolean {
        return this.ended;
    }

    whenIdle(): Promise<void> {
        return this.queue;
    }

    onClose(cleanup: () => void): void {
        if (this.ended) cleanup();
        else this.cleanup.add(cleanup);
    }

    private async currentAuth(): Promise<GameSessionTokenPayload | null> {
        if (this.ended) return null;
        const current = await this.resolveAuth();
        if (
            !current ||
            this.ended ||
            current.sessionId !== this.auth.sessionId ||
            current.user.id !== this.auth.user.id ||
            current.profile !== this.auth.profile
        ) {
            this.close();
            return null;
        }
        return current;
    }

    enqueue(work: (auth: GameSessionTokenPayload) => Promise<string | null>): void {
        if (this.ended) return;
        if (this.pending >= MAX_PENDING_FRAMES || this.response.writableLength > MAX_BUFFER_BYTES) {
            this.close();
            return;
        }
        this.pending += 1;
        this.queue = this.queue
            .then(async () => {
                const current = await this.currentAuth();
                if (!current) return;
                const frame = await work(current);
                if (!frame || !(await this.currentAuth())) return;
                if (Buffer.byteLength(frame) > MAX_BUFFER_BYTES || !this.response.write(frame)) this.close();
            })
            .catch(() => {
                // Redis/auth failure is fail closed. Reconnect must authenticate again.
                this.close();
            })
            .finally(() => {
                this.pending -= 1;
            });
    }

    close = (): void => {
        if (this.ended) return;
        this.ended = true;
        clearTimeout(this.expiryTimer);
        this.response.off('close', this.close);
        this.response.off('error', this.close);
        for (const cleanup of this.cleanup) cleanup();
        this.cleanup.clear();
        if (!this.response.destroyed && !this.response.writableEnded) this.response.end();
    };
}
