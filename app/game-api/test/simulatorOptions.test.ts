import { describe, expect, it } from 'vitest';

import { AVAILABLE_NATION_TRAIT_KEYS } from '@sammo-ts/logic';

import { loadBattleSimTraitOptions } from '../src/battleSim/simulatorOptions.js';

describe('selectable trait options', () => {
    it('uses the Ref available nation-type list for founding and battle simulation inputs', async () => {
        const options = await loadBattleSimTraitOptions();

        expect(options.nationTypes.map((entry) => entry.key)).toEqual(AVAILABLE_NATION_TRAIT_KEYS);
        expect(options.nationTypes).not.toEqual(
            expect.arrayContaining([expect.objectContaining({ key: 'che_중립' })])
        );
    });
});
