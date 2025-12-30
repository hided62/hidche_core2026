import { describe, expect, it } from 'vitest';

import { buildTurnDaemonStreamKeys } from '../src/daemon/streamKeys.js';

describe('buildTurnDaemonStreamKeys', () => {
    it('namespaces streams by profile', () => {
        const keys = buildTurnDaemonStreamKeys('che:default');
        expect(keys.commandStream).toBe('sammo:che:default:turn-daemon:commands');
        expect(keys.eventStream).toBe('sammo:che:default:turn-daemon:events');
    });
});
