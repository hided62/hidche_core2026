import type { PhaseMetrics } from './metrics.js';

const forbiddenKeys = new Set([
    'at',
    'lastTurnTime',
    'revision',
    'generalId',
    'cityId',
    'nationId',
    'entityId',
    'mailboxId',
    'messageId',
    'senderId',
]);

export const containsForbiddenPublicField = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(containsForbiddenPublicField);
    if (typeof value !== 'object' || value === null) return false;
    return Object.entries(value).some(([key, item]) => forbiddenKeys.has(key) || containsForbiddenPublicField(item));
};

export interface ParsedSseEvent {
    event: string;
    data: string;
}

export class SseParser {
    private buffer = '';
    private eventName = 'message';
    private data: string[] = [];

    constructor(private readonly onEvent: (event: ParsedSseEvent) => void) {}

    push(chunk: string): void {
        this.buffer += chunk;
        let newline = this.buffer.indexOf('\n');
        while (newline >= 0) {
            const rawLine = this.buffer.slice(0, newline);
            this.buffer = this.buffer.slice(newline + 1);
            this.consumeLine(rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine);
            newline = this.buffer.indexOf('\n');
        }
    }

    finish(): void {
        if (this.buffer.length > 0) this.consumeLine(this.buffer.endsWith('\r') ? this.buffer.slice(0, -1) : this.buffer);
        this.buffer = '';
        this.dispatch();
    }

    private consumeLine(line: string): void {
        if (line === '') {
            this.dispatch();
            return;
        }
        if (line.startsWith(':')) return;
        const separator = line.indexOf(':');
        const field = separator < 0 ? line : line.slice(0, separator);
        let value = separator < 0 ? '' : line.slice(separator + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') this.eventName = value;
        if (field === 'data') this.data.push(value);
    }

    private dispatch(): void {
        if (this.data.length > 0) this.onEvent({ event: this.eventName, data: this.data.join('\n') });
        this.eventName = 'message';
        this.data = [];
    }
}

const wait = (milliseconds: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
        if (signal.aborted) return resolve();
        const done = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', done);
            resolve();
        };
        const timer = setTimeout(done, milliseconds);
        signal.addEventListener('abort', done, { once: true });
    });

export const runSseConnection = async (options: {
    url: string;
    token: string;
    signal: AbortSignal;
    metrics: PhaseMetrics;
    onActiveChange: (delta: number) => void;
    reconnectDelayMs?: number;
}): Promise<void> => {
    let priorAttempt = false;
    while (!options.signal.aborted) {
        if (priorAttempt) options.metrics.sseReconnects += 1;
        priorAttempt = true;
        options.metrics.sseAttempts += 1;
        let active = false;
        try {
            const response = await fetch(options.url, {
                headers: { accept: 'text/event-stream', authorization: `Bearer ${options.token}` },
                signal: options.signal,
            });
            if (!response.ok || !response.body) {
                options.metrics.sseFailures += 1;
                await response.body?.cancel();
            } else {
                options.metrics.sseOpened += 1;
                active = true;
                options.onActiveChange(1);
                const parser = new SseParser(({ event, data }) => {
                    options.metrics.recordSseEvent(event);
                    try {
                        if (containsForbiddenPublicField(JSON.parse(data))) options.metrics.ssePrivacyViolations += 1;
                    } catch {
                        options.metrics.sseFailures += 1;
                    }
                });
                const decoder = new TextDecoder();
                for await (const chunk of response.body) parser.push(decoder.decode(chunk, { stream: true }));
                parser.push(decoder.decode());
                parser.finish();
                if (!options.signal.aborted) options.metrics.sseFailures += 1;
            }
        } catch (error) {
            if (!options.signal.aborted) options.metrics.sseFailures += 1;
        } finally {
            if (active) {
                options.metrics.sseClosed += 1;
                options.onActiveChange(-1);
            }
        }
        if (!options.signal.aborted) await wait(options.reconnectDelayMs ?? 1000, options.signal);
    }
};
