import { describe, expect, it } from 'vitest';

import { buildGameEventChannel, type RealtimeEvent } from '@sammo-ts/common';
import { parseRealtimeEvent } from '../src/realtime/eventHub.js';
import { formatSseFrame } from '../src/realtime/sse.js';

describe('formatSseFrame', () => {
    it('renders basic SSE payloads', () => {
        const output = formatSseFrame({
            event: 'ping',
            id: '1',
            retry: 1500,
            data: 'ok',
        });

        expect(output).toBe(['event: ping', 'id: 1', 'retry: 1500', 'data: ok', ''].join('\n'));
    });

    it('splits multiline data', () => {
        const output = formatSseFrame({
            event: 'notice',
            data: 'first\nsecond',
        });

        expect(output).toBe(['event: notice', 'data: first', 'data: second', ''].join('\n'));
    });
});

describe('parseRealtimeEvent', () => {
    it('accepts valid realtime events', () => {
        const payload: RealtimeEvent = {
            type: 'turnCompleted',
            at: '2026-01-01T00:00:00.000Z',
            lastTurnTime: '2026-01-01T00:00:00.000Z',
        };
        const parsed = parseRealtimeEvent(JSON.stringify(payload));

        expect(parsed?.type).toBe('turnCompleted');
    });

    it('rejects invalid payloads', () => {
        expect(parseRealtimeEvent('not-json')).toBeNull();
        expect(parseRealtimeEvent(JSON.stringify({}))).toBeNull();
    });
});

describe('buildGameEventChannel', () => {
    it('namespaces channels by profile', () => {
        expect(buildGameEventChannel('che:default')).toBe('sammo:che:default:realtime:events');
    });
});
