import assert from 'node:assert/strict';
import test from 'node:test';

import {
    GAME_SERVER_ACTIVITY_FRESHNESS_MS,
    createGameServerActivityTracker,
    isRecentGameServerActivity,
} from '../src/utils/gameServerActivity.ts';

void test('keeps the most recently observed server contact timestamp', () => {
    const tracker = createGameServerActivityTracker();
    tracker.markContact(2_000);
    tracker.markContact(1_000);
    tracker.markContact(Number.NaN);
    assert.equal(tracker.lastContactAt.value, 1_000);
});

void test('treats three heartbeat intervals as recent activity', () => {
    assert.equal(isRecentGameServerActivity(1_000, 1_000 + GAME_SERVER_ACTIVITY_FRESHNESS_MS), true);
    assert.equal(isRecentGameServerActivity(1_000, 1_001 + GAME_SERVER_ACTIVITY_FRESHNESS_MS), false);
    assert.equal(isRecentGameServerActivity(null, 1_000), false);
});
