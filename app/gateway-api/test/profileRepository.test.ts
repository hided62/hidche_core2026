import { describe, expect, it } from 'vitest';

import { buildRetryOperationPayload, buildRetryOperationSource } from '../src/orchestrator/profileRepository.js';

describe('buildRetryOperationPayload', () => {
    it('pins the first failed operation as the install generation', () => {
        expect(
            buildRetryOperationPayload({ install: { scenarioId: 1010 } }, '11111111-1111-4111-8111-111111111111')
        ).toEqual({
            install: { scenarioId: 1010 },
            installOperationId: '11111111-1111-4111-8111-111111111111',
        });
    });

    it('preserves the original install generation across chained retries', () => {
        expect(
            buildRetryOperationPayload(
                {
                    install: { scenarioId: 903 },
                    installOperationId: 'original-install-generation',
                },
                'newer-failed-operation'
            )
        ).toEqual({
            install: { scenarioId: 903 },
            installOperationId: 'original-install-generation',
        });
    });
});

describe('buildRetryOperationSource', () => {
    it('pins a resolved branch operation to the original commit', () => {
        expect(
            buildRetryOperationSource({
                sourceMode: 'BRANCH',
                sourceRef: 'main',
                resolvedCommitSha: 'abcdef0123456789abcdef0123456789abcdef01',
            })
        ).toEqual({
            sourceMode: 'COMMIT',
            sourceRef: 'abcdef0123456789abcdef0123456789abcdef01',
        });
    });

    it('keeps the requested source when resolution never completed', () => {
        expect(
            buildRetryOperationSource({
                sourceMode: 'BRANCH',
                sourceRef: 'main',
                resolvedCommitSha: null,
            })
        ).toEqual({ sourceMode: 'BRANCH', sourceRef: 'main' });
    });
});
