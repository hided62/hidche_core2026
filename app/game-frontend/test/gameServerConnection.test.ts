import assert from 'node:assert/strict';
import test from 'node:test';

import {
    canConfirmGameServerRecovery,
    createGameServerConnectionTracker,
    isGameServerRecoveryRequest,
    isRetryableGameServerStatus,
    retryDelayForFailure,
} from '../src/utils/gameServerConnection.ts';

void test('classifies only transient deployment gateway responses as reconnectable', () => {
    assert.equal(isRetryableGameServerStatus(502), true);
    assert.equal(isRetryableGameServerStatus(503), true);
    assert.equal(isRetryableGameServerStatus(504), true);
    assert.equal(isRetryableGameServerStatus(401), false);
    assert.equal(isRetryableGameServerStatus(403), false);
    assert.equal(isRetryableGameServerStatus(500), false);
});

void test('does not treat a server error from the recovery probe as restored service', () => {
    assert.equal(canConfirmGameServerRecovery(200), true);
    assert.equal(canConfirmGameServerRecovery(401), true);
    assert.equal(canConfirmGameServerRecovery(403), true);
    assert.equal(canConfirmGameServerRecovery(500), false);
    assert.equal(canConfirmGameServerRecovery(503), false);
});

void test('uses bounded reconnect delays', () => {
    assert.equal(retryDelayForFailure(1), 500);
    assert.equal(retryDelayForFailure(2), 1_000);
    assert.equal(retryDelayForFailure(3), 2_000);
    assert.equal(retryDelayForFailure(4), 4_000);
    assert.equal(retryDelayForFailure(20), 4_000);
});

void test('recognizes only the read-only lobby probe as connection recovery evidence', () => {
    assert.equal(isGameServerRecoveryRequest('/che/api/trpc/lobby.info'), true);
    assert.equal(isGameServerRecoveryRequest('/che/api/trpc/auth.status,lobby.info?batch=1'), true);
    assert.equal(isGameServerRecoveryRequest('/che/api/trpc/join.getConfig'), false);
});

void test('retains reconnecting state until the server responds again', () => {
    const tracker = createGameServerConnectionTracker();
    tracker.markFailure();
    tracker.markFailure();
    assert.equal(tracker.status.value, 'reconnecting');
    tracker.markConnected();
    assert.equal(tracker.status.value, 'connected');
});
