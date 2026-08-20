import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DEFAULT_MOBILE_MAIN_PANEL_ORDER,
    MOBILE_MAIN_PANEL_ORDER_STORAGE_KEY,
    loadMobileMainPanelOrder,
    moveMobileMainPanel,
    normalizeMobileMainPanelOrder,
    parseMobileMainPanelOrder,
    saveMobileMainPanelOrder,
} from '../src/utils/mobileMainPanelOrder.ts';

void test('uses the Ref mobile panel order as the default', () => {
    assert.deepEqual(DEFAULT_MOBILE_MAIN_PANEL_ORDER, [
        'commands',
        'nation-menu',
        'nation',
        'general',
        'city',
        'map',
        'records',
        'global-menu',
        'messages',
    ]);
    assert.deepEqual(parseMobileMainPanelOrder(null), DEFAULT_MOBILE_MAIN_PANEL_ORDER);
});

void test('keeps known unique entries and appends newly introduced panels', () => {
    assert.deepEqual(normalizeMobileMainPanelOrder(['messages', 'commands', 'messages', 'unknown']), [
        'messages',
        'commands',
        'nation-menu',
        'nation',
        'general',
        'city',
        'map',
        'records',
        'global-menu',
    ]);
    assert.deepEqual(parseMobileMainPanelOrder('{broken'), DEFAULT_MOBILE_MAIN_PANEL_ORDER);
});

void test('moves and persists the normalized order', () => {
    const values = new Map<string, string>();
    const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
    };
    const moved = moveMobileMainPanel(DEFAULT_MOBILE_MAIN_PANEL_ORDER, 8, 0);
    assert.equal(moved[0], 'messages');
    assert.deepEqual(saveMobileMainPanelOrder(moved, storage), moved);
    assert.equal(values.has(MOBILE_MAIN_PANEL_ORDER_STORAGE_KEY), true);
    assert.deepEqual(loadMobileMainPanelOrder(storage), moved);
});
