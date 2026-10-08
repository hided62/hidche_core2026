import { createHmac } from 'node:crypto';

export interface AuthCounter {
    key: string;
    limit: number;
    windowMs: number;
}

export interface AuthCounterStore {
    readonly available?: boolean;
    /** Atomically check every counter, then charge them only when accepted. */
    consume(counters: AuthCounter[]): Promise<number>;
}

export class AuthBudgetError extends Error {
    constructor(
        readonly reason: 'limited' | 'unavailable',
        readonly retryAfterSeconds = 1
    ) {
        super(
            reason === 'limited'
                ? 'Authentication attempts are temporarily limited.'
                : 'Authentication protection is unavailable.'
        );
    }
}

const CONSUME_SCRIPT = `
local retry = 0
for i, key in ipairs(KEYS) do
    local count = tonumber(redis.call('GET', key) or '0')
    if count >= tonumber(ARGV[i * 2 - 1]) then
        local ttl = redis.call('PTTL', key)
        if ttl < 0 then
            return -1
        end
        retry = math.max(retry, math.max(ttl, 1))
    end
end
if retry > 0 then return retry end
for i, key in ipairs(KEYS) do
    local count = redis.call('INCR', key)
    if count == 1 then redis.call('PEXPIRE', key, ARGV[i * 2]) end
end
return 0
`;

export class RedisAuthCounterStore implements AuthCounterStore {
    constructor(
        private readonly client: {
            readonly isReady?: boolean;
            withAbortSignal?: (signal: AbortSignal) => {
                eval: (script: string, options: { keys: string[]; arguments: string[] }) => Promise<unknown>;
            };
            eval: (script: string, options: { keys: string[]; arguments: string[] }) => Promise<unknown>;
        }
    ) {}

    get available(): boolean {
        return this.client.isReady !== false;
    }

    async consume(counters: AuthCounter[]): Promise<number> {
        if (this.client.isReady === false) throw new AuthBudgetError('unavailable');
        const client = this.client.withAbortSignal?.(AbortSignal.timeout(2000)) ?? this.client;
        const result = await client.eval(CONSUME_SCRIPT, {
            keys: counters.map((counter) => counter.key),
            arguments: counters.flatMap((counter) => [String(counter.limit), String(counter.windowMs)]),
        });
        if (typeof result !== 'number' || !Number.isFinite(result) || result < 0) {
            throw new AuthBudgetError('unavailable');
        }
        return result;
    }
}

/** Direct callers/tests have a bounded local store; the HTTP server always injects Redis. */
export class InMemoryAuthCounterStore implements AuthCounterStore {
    private readonly entries = new Map<string, { count: number; expiresAt: number }>();

    async consume(counters: AuthCounter[]): Promise<number> {
        const now = Date.now();
        for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(key);
        if (this.entries.size + counters.filter((counter) => !this.entries.has(counter.key)).length > 8192) {
            throw new AuthBudgetError('unavailable');
        }
        let retryMs = 0;
        for (const counter of counters) {
            const entry = this.entries.get(counter.key);
            if (entry && entry.count >= counter.limit) retryMs = Math.max(retryMs, entry.expiresAt - now);
        }
        if (retryMs > 0) return retryMs;
        for (const counter of counters) {
            const entry = this.entries.get(counter.key) ?? { count: 0, expiresAt: now + counter.windowMs };
            entry.count += 1;
            this.entries.set(counter.key, entry);
        }
        return 0;
    }
}

const EXPENSIVE_ACTIONS = new Set([
    'auth.bootstrapLocal',
    'auth.kakaoExchange',
    'auth.kakaoResolveAccount',
    'auth.kakaoSetPassword',
    'auth.register',
    'auth.registerLocal',
    'auth.login',
    'auth.kakaoOtp',
    'account.changePassword',
    'account.scheduleDeletion',
]);
const PUBLIC_ACTIONS = new Set(['auth.passwordKey', 'auth.checkRegistrationField', 'auth.kakaoStart']);

export const isBudgetedAuthAction = (action: string): boolean =>
    EXPENSIVE_ACTIONS.has(action) || PUBLIC_ACTIONS.has(action);

export class AuthAttemptBudget {
    private active = 0;
    private pendingChecks = 0;

    constructor(
        private readonly store: AuthCounterStore,
        private readonly prefix: string,
        private readonly secret: string
    ) {}

    private key(kind: string, value: string): string {
        const digest = createHmac('sha256', this.secret).update(`auth-budget-v1:${kind}:${value}`).digest('hex');
        return `${this.prefix}:auth-budget:v1:${kind}:${digest}`;
    }

    async run<T>(
        action: string,
        client: string,
        subject: string | undefined | (() => Promise<string | undefined>),
        work: () => Promise<T>
    ): Promise<T> {
        if (this.store.available === false || this.pendingChecks >= 32) throw new AuthBudgetError('unavailable');
        const expensive = EXPENSIVE_ACTIONS.has(action);
        if (expensive && this.active >= 4) throw new AuthBudgetError('limited');
        if (expensive) this.active += 1;
        try {
            const consume = async (): Promise<number> => {
                const resolvedSubject = typeof subject === 'function' ? await subject() : subject;
                const counters: AuthCounter[] = [
                    { key: this.key('global', 'all'), limit: 1200, windowMs: 60_000 },
                    { key: this.key('client', client), limit: 600, windowMs: 60_000 },
                ];
                if (resolvedSubject)
                    counters.push({ key: this.key('subject', resolvedSubject), limit: 10, windowMs: 60_000 });
                return this.store.consume(counters);
            };
            this.pendingChecks += 1;
            const checking = consume();
            // A caller timeout does not prove the underlying Redis/actor read settled.
            void checking.then(
                () => {
                    this.pendingChecks -= 1;
                },
                () => {
                    this.pendingChecks -= 1;
                }
            );
            let timeout: ReturnType<typeof setTimeout> | undefined;
            let retryMs: number;
            try {
                retryMs = await Promise.race([
                    checking,
                    new Promise<never>((_resolve, reject) => {
                        timeout = setTimeout(() => reject(new AuthBudgetError('unavailable')), 2000);
                        timeout.unref();
                    }),
                ]);
            } catch {
                throw new AuthBudgetError('unavailable');
            } finally {
                clearTimeout(timeout);
            }
            if (retryMs > 0) throw new AuthBudgetError('limited', Math.max(1, Math.ceil(retryMs / 1000)));
            return await work();
        } finally {
            if (expensive) this.active -= 1;
        }
    }
}
