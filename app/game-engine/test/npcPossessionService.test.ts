import { describe, expect, it } from 'vitest';

import { buildNpcSelectionTokenSeed } from '../src/turn/npcPossessionService.js';

describe('NPC possession legacy token contracts', () => {
    it('builds the Ref SelectNPCToken seed from the Seoul whole-second timestamp', () => {
        expect(buildNpcSelectionTokenSeed('seed', 42, new Date('2026-07-30T23:59:58.987Z'))).toBe(
            'str(4,seed)|str(14,SelectNPCToken)|int(42)|str(19,2026-07-31 08:59:58)'
        );
    });
});
