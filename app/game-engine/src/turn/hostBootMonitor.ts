import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { isRecord } from '@sammo-ts/common';

export interface HostBootMonitor {
    hasChanged(): Promise<boolean>;
}

const mac = (key: Buffer, value: string): string => createHmac('sha256', key).update(value).digest('hex');

/** 부팅 세대는 첫 인증 응답에 고정한다. 통신 실패는 기존 lease 복구를 막지 않는다. */
export const createHostBootMonitor = (options: {
    url: string;
    key: Buffer;
    pollMs?: number;
    timeoutMs?: number;
    now?: () => number;
    wallNow?: () => number;
    onUnavailable?: () => void;
    onVerified?: () => void;
}): HostBootMonitor => {
    const url = new URL(options.url);
    if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/v1/boot-id'
    ) {
        throw new Error('Host boot URL must use HTTP(S) and /v1/boot-id without credentials or query.');
    }
    if (options.key.length !== 32) throw new Error('Host boot key must contain exactly 32 bytes.');
    const now = options.now ?? (() => performance.now());
    const wallNow = options.wallNow ?? (() => Date.now());
    let baseline: string | null = null;
    let changed = false;
    let lastAttempt = -Infinity;
    let lastWall = 0;
    let lastWarning = -Infinity;
    let inFlight: Promise<boolean> | null = null;
    const sample = async (): Promise<boolean> => {
        const nonce = randomBytes(32).toString('hex');
        const response = await fetch(url, {
            method: 'GET',
            redirect: 'error',
            signal: AbortSignal.timeout(options.timeoutMs ?? 1_000),
            headers: {
                'x-sammo-challenge': nonce,
                'x-sammo-signature': mac(options.key, `sammo-host-boot-request-v1\n${nonce}`),
            },
        });
        if (!response.ok || !response.body) {
            await response.body?.cancel();
            throw new Error('Host boot response unavailable.');
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.length;
                if (size > 2_048) throw new Error('Host boot response exceeds its limit.');
                chunks.push(value);
            }
        } finally {
            await reader.cancel();
        }
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (
            !isRecord(body) ||
            body.version !== 1 ||
            body.challenge !== nonce ||
            typeof body.bootId !== 'string' ||
            !/^[a-f0-9]{64}$/.test(body.bootId) ||
            typeof body.signature !== 'string' ||
            !/^[a-f0-9]{64}$/.test(body.signature)
        ) {
            throw new Error('Host boot response is invalid.');
        }
        const expected = mac(options.key, `sammo-host-boot-response-v1\n${nonce}\n${body.bootId}`);
        if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(body.signature, 'hex'))) {
            throw new Error('Host boot response signature is invalid.');
        }
        if (baseline === null) {
            baseline = body.bootId;
            options.onVerified?.();
        }
        changed ||= body.bootId !== baseline;
        return changed;
    };
    return {
        hasChanged(): Promise<boolean> {
            if (changed) return Promise.resolve(true);
            if (inFlight) return inFlight;
            const current = now();
            const wall = wallNow();
            const discontinuity = Math.abs(wall - lastWall - (current - lastAttempt)) > 1_000;
            if (current - lastAttempt < (options.pollMs ?? 2_000) && !discontinuity) return Promise.resolve(false);
            lastAttempt = current;
            lastWall = wall;
            inFlight = sample()
                .catch(() => {
                    if (current - lastWarning >= 60_000) {
                        options.onUnavailable?.();
                        lastWarning = current;
                    }
                    return false;
                })
                .finally(() => {
                    inFlight = null;
                });
            return inFlight;
        },
    };
};

export const loadHostBootMonitor = async (env: NodeJS.ProcessEnv): Promise<HostBootMonitor | undefined> => {
    const url = env.TURN_HOST_BOOT_URL?.trim();
    const keyFile = env.TURN_HOST_BOOT_KEY_FILE?.trim();
    if (!url && !keyFile) return undefined;
    try {
        if (!url || !keyFile) throw new Error('Incomplete optional configuration.');
        const encoded = (await readFile(keyFile, 'utf8')).trim();
        if (!/^[a-f0-9]{64}$/.test(encoded)) throw new Error('Invalid optional key file.');
        return createHostBootMonitor({
            url,
            key: Buffer.from(encoded, 'hex'),
            onVerified: () => console.info('[turn-daemon] host boot identity verified.'),
            onUnavailable: () => {
                console.warn('[turn-daemon] host boot identity unavailable; ordinary lease recovery remains active.');
            },
        });
    } catch {
        // 보조 관측기의 설정/파일 부재도 게임 기동의 필수 의존성이 되지 않는다.
        console.warn('[turn-daemon] host boot observation disabled; check optional configuration and key file.');
        return undefined;
    }
};
