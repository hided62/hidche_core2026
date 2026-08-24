import assert from 'node:assert/strict';
import test from 'node:test';

import {
    parseConditionalIntegrationFileRegistry,
    selectEnabledConditionalIntegrationFiles,
    validateConditionalIntegrationFileRegistry,
} from './check-conditional-integration-files.mjs';

test('keeps every non-database conditional Ref suite in one requirement group', async () => {
    const entries = await validateConditionalIntegrationFileRegistry();
    const counts = Object.fromEntries(
        [...new Set(entries.map(({ requirement }) => requirement))]
            .sort()
            .map((requirement) => [requirement, entries.filter((entry) => entry.requirement === requirement).length])
    );

    assert.deepEqual(counts, {
        reference_command: 5,
        reference_full_lifecycle: 1,
        reference_instant_diplomacy: 1,
        reference_monthly: 1,
        reference_snapshot: 1,
        saved_trace_pair: 1,
    });
});

test('rejects duplicate files and unsupported requirements', () => {
    assert.throws(
        () =>
            parseConditionalIntegrationFileRegistry(
                'test/example.integration.test.ts\treference_command\n' +
                    'test/example.integration.test.ts\treference_command\n'
            ),
        /duplicates integration test path/u
    );
    assert.throws(
        () => parseConditionalIntegrationFileRegistry('test/example.integration.test.ts\tunknown\n'),
        /unsupported environment requirement/u
    );
});

test('enables Ref suites only with the Ref runtime and saved traces only as a pair', async () => {
    const entries = await validateConditionalIntegrationFileRegistry();

    assert.deepEqual(selectEnabledConditionalIntegrationFiles(entries, {}), {
        referenceFiles: [],
        savedTraceFiles: [],
    });
    assert.equal(
        selectEnabledConditionalIntegrationFiles(entries, { TURN_DIFFERENTIAL_REFERENCE: '1' }).referenceFiles.length,
        9
    );
    assert.deepEqual(
        selectEnabledConditionalIntegrationFiles(entries, {
            TURN_REFERENCE_TRACE: '/tmp/ref.json',
            TURN_CORE_TRACE: '/tmp/core.json',
        }).savedTraceFiles,
        ['test/turnTraceFiles.integration.test.ts']
    );
    assert.throws(
        () => selectEnabledConditionalIntegrationFiles(entries, { TURN_REFERENCE_TRACE: '/tmp/ref.json' }),
        /must be provided together/u
    );
});
