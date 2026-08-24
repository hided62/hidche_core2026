import { describe, expect, it } from 'vitest';

import { buildNpcSelectionTokenSeed } from '../src/turn/npcPossessionService.js';

describe('NPC possession legacy token contracts', () => {
    it('builds the Ref SelectNPCToken seed from the accepted game tick', () => {
        expect(buildNpcSelectionTokenSeed('seed', 42, 72_000_001)).toBe(
            'str(4,seed)|str(14,SelectNPCToken)|int(42)|int(72000001)'
        );
    });
});
