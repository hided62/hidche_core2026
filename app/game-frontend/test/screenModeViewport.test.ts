import assert from 'node:assert/strict';
import test from 'node:test';

import {
    normalizeScreenMode,
    resolveAutoViewportContent,
    resolveViewportContent,
    SCREEN_MODE_DESKTOP_MEDIA_QUERY,
    SCREEN_MODE_DESKTOP_MIN_WIDTH,
    SCREEN_MODE_MOBILE_MEDIA_QUERY,
} from '../src/utils/screenModeViewport.ts';

void test('main and map layouts share one 939/940 screen-mode boundary', () => {
    assert.equal(SCREEN_MODE_DESKTOP_MIN_WIDTH, 940);
    assert.equal(SCREEN_MODE_DESKTOP_MEDIA_QUERY, '(min-width: 940px)');
    assert.equal(SCREEN_MODE_MOBILE_MEDIA_QUERY, '(max-width: 939.98px)');
});

void test('automatic mode follows the Ref physical-screen thresholds', () => {
    assert.equal(resolveAutoViewportContent({ deviceWidth: 390, viewportHeight: 844 }), 'width=500');
    assert.equal(
        resolveAutoViewportContent({ deviceWidth: 699, viewportHeight: 900 }),
        'width=device-width, initial-scale=1'
    );
    assert.equal(resolveAutoViewportContent({ deviceWidth: 700, viewportHeight: 900 }), 'width=1000');
    assert.equal(resolveAutoViewportContent({ deviceWidth: 820, viewportHeight: 1180 }), 'width=1000');
});

void test('automatic mode preserves the Ref short-viewport aspect-ratio branch', () => {
    assert.equal(resolveAutoViewportContent({ deviceWidth: 600, viewportHeight: 650 }), 'height=700');
    assert.equal(resolveAutoViewportContent({ deviceWidth: 650, viewportHeight: 600 }), 'width=1000');
});

void test('explicit modes override automatic measurements and invalid storage falls back to auto', () => {
    const phone = { deviceWidth: 390, viewportHeight: 844 };
    const tablet = { deviceWidth: 820, viewportHeight: 1180 };

    assert.equal(resolveViewportContent('1000px', phone), 'width=1000');
    assert.equal(resolveViewportContent('500px', tablet), 'width=500');
    assert.equal(normalizeScreenMode('1000px'), '1000px');
    assert.equal(normalizeScreenMode('500px'), '500px');
    assert.equal(normalizeScreenMode('unexpected'), 'auto');
    assert.equal(normalizeScreenMode(null), 'auto');
});
