import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveMapBackgroundPath, resolveMapSeason, resolveNextMapSeason } from '../src/utils/mapBackground.ts';

void describe('mapBackground', () => {
    void it('maps month boundaries to the four Ref seasons', () => {
        assert.equal(resolveMapSeason(1), 'spring');
        assert.equal(resolveMapSeason(3), 'spring');
        assert.equal(resolveMapSeason(4), 'summer');
        assert.equal(resolveMapSeason(6), 'summer');
        assert.equal(resolveMapSeason(7), 'fall');
        assert.equal(resolveMapSeason(9), 'fall');
        assert.equal(resolveMapSeason(10), 'winter');
        assert.equal(resolveMapSeason(12), 'winter');
    });

    void it('uses seasonal CHE backgrounds for CHE and mini-CHE themes', () => {
        assert.deepEqual(resolveMapBackgroundPath('che', 'summer'), {
            path: 'map/che/bg_summer.jpg',
            seasonal: true,
        });
        assert.deepEqual(resolveMapBackgroundPath('miniche_clean', 'winter'), {
            path: 'map/che/bg_winter.jpg',
            seasonal: true,
        });
    });

    void it('keeps seasonless theme backgrounds fixed across season changes', () => {
        for (const [theme, expectedPath] of [
            ['ludo_rathowm', 'map/ludo_rathowm/back.jpg'],
            ['chess', 'map/chess/chessboard.png'],
            ['pokemon_v1', 'map/pokemon_v1/back_pal8.png'],
            ['cr', 'map/cr/bg-fs8.png'],
        ] as const) {
            assert.deepEqual(resolveMapBackgroundPath(theme, 'spring'), {
                path: expectedPath,
                seasonal: false,
            });
            assert.deepEqual(resolveMapBackgroundPath(theme, 'winter'), {
                path: expectedPath,
                seasonal: false,
            });
        }
    });

    void it('cycles the next background season across a year boundary', () => {
        assert.equal(resolveNextMapSeason('spring'), 'summer');
        assert.equal(resolveNextMapSeason('summer'), 'fall');
        assert.equal(resolveNextMapSeason('fall'), 'winter');
        assert.equal(resolveNextMapSeason('winter'), 'spring');
    });
});
