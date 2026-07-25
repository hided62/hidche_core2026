import { describe, expect, it } from 'vitest';

import { IdempotentTurnDaemonTransport } from '../src/daemon/idempotentTransport.js';
import { InMemoryTurnDaemonTransport } from '../src/daemon/inMemoryTransport.js';

describe('IdempotentTurnDaemonTransport', () => {
    it('derives stable ordered engine request IDs from the API input event', async () => {
        const inner = new InMemoryTurnDaemonTransport();
        const firstAttempt = new IdempotentTurnDaemonTransport(inner, 'api-event');
        const retry = new IdempotentTurnDaemonTransport(inner, 'api-event');

        await firstAttempt.sendCommand({ type: 'vacation', generalId: 7 });
        await firstAttempt.sendCommand({ type: 'dropItem', generalId: 7, itemType: 'weapon' });
        await retry.sendCommand({ type: 'vacation', generalId: 7 });

        expect(inner.commands.map((entry) => entry.requestId)).toEqual([
            'api-event:engine:0:vacation',
            'api-event:engine:1:dropItem',
            'api-event:engine:0:vacation',
        ]);
    });
});
