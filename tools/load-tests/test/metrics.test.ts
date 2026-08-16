import assert from 'node:assert/strict';
import test from 'node:test';

import { PhaseMetrics, percentile, summarizeDistribution, summarizePhaseMetrics } from '../src/metrics.js';

void test('nearest-rank percentiles and summaries are deterministic', () => {
    const values = [100, 1, 5, 3, 2, 4];
    const sorted = [...values].sort((left, right) => left - right);
    assert.equal(percentile(sorted, 50), 3);
    assert.equal(percentile(sorted, 95), 100);
    assert.deepEqual(summarizeDistribution(values), {
        count: 6,
        min: 1,
        max: 100,
        mean: 19.167,
        p50: 3,
        p95: 100,
        p99: 100,
    });
});

void test('phase aggregation separates success, error, latency, and event counters', () => {
    const metrics = new PhaseMetrics();
    metrics.recordHttp('own', 10, null);
    metrics.recordHttp('own', 20, 'http-500');
    metrics.recordSseEvent('ready');
    metrics.recordSseEvent('ready');
    metrics.recordHttpResult('own', 'unchanged');
    metrics.processRssBytes.push(100, 200);
    metrics.sseActiveConnections.push(0, 2);
    const summary = summarizePhaseMetrics(metrics, {
        cpuPercentOfOneCore: 5,
        rssBytes: summarizeDistribution(metrics.processRssBytes),
        eventLoopLagMs: { min: 1, max: 2, mean: 1.5, p50: 1, p95: 2, p99: 2 },
    });
    assert.deepEqual(summary.http.success, { own: 1 });
    assert.deepEqual(summary.http.errors, { 'own:http-500': 1 });
    assert.deepEqual(summary.http.results, { 'own:unchanged': 1 });
    assert.equal(summary.http.latencyMs.own?.p50, 10);
    assert.deepEqual(summary.sse.events, { ready: 2 });
    assert.equal(summary.sse.activeConnections.max, 2);
});
