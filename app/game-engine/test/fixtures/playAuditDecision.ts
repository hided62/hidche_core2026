import type { PendingAuditDecision } from '../../src/playAudit/decision.js';
export const buildAuditDecisionFixture = (id: string, serverId = 'decision-old'): PendingAuditDecision => {
    const base = {
        phase: 'general' as const,
        generalId: 990321,
        nationId: 990321,
        cityId: 1,
        npcState: 2,
        year: 190,
        month: 1,
        tick: 4_320_000_000,
    };
    return {
        ...base,
        id,
        serverId,
        executionId: id,
        summary: {
            schemaVersion: 1,
            coverage: 'PROCEDURES',
            clockRevision: 1,
            codeVersion: null,
            policyRefs: {},
            requestedAction: '휴식',
            selectedAction: 'che_징병',
            selectedReason: '징병',
            executedAction: '휴식',
            completed: false,
            usedFallback: true,
            blockedReason: '자원 부족',
        },
        steps: [
            { ...base, sequence: 0, kind: 'DECISION_START', reservedAction: '휴식' },
            ...Array.from({ length: 300 }, (_, index) => ({
                ...base,
                sequence: index + 1,
                kind: 'RNG' as const,
                method: 'nextBool',
                parameters: [0.5],
                result: true,
            })),
            { ...base, sequence: 301, kind: 'DECISION_END', action: 'che_징병', reason: '징병' },
        ],
    };
};

export const buildAuditExecutionFixture = () => ({
    kind: 'EXECUTION_ATTEMPT' as const,
    attempt: 0,
    requestedAction: 'che_징병',
    resolvedAction: 'che_징병',
    executedAction: '휴식',
    checks: [{ stage: 'CONSTRAINT' as const, action: 'che_징병', result: 'deny' as const, reason: '자원 부족' }],
    completed: true,
    usedFallback: true,
    alternativeAction: null,
    preparation: null,
});
