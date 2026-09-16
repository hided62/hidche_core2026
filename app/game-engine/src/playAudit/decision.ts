import { auditPolicyHash } from './policy.js';
import type { AiDecisionTraceEvent } from '../turn/ai/generalAi/trace.js';

export interface PendingAuditDecision {
    id: string;
    serverId: string;
    executionId: string;
    phase: 'general' | 'nation';
    generalId: number;
    nationId: number;
    cityId: number;
    npcState: number;
    year: number;
    month: number;
    tick: number;
    summary: {
        schemaVersion: 1;
        coverage: 'PROCEDURES';
        clockRevision: number;
        codeVersion: string | null;
        policyRefs: Record<string, string>;
        requestedAction: string;
        selectedAction: string | null;
        selectedReason: string | null;
        executedAction: string;
        completed: boolean | null;
        usedFallback: boolean;
        blockedReason: string | null;
    };
    steps: AiDecisionTraceEvent[];
}

export const auditDecisionIdentity = (serverId: string, generalId: number, tick: number, revision: number) =>
    auditPolicyHash([serverId, generalId, tick, revision]);

// 확정된 전체 SHA만 받는다. branch/tag/축약 SHA나 미상 값을 현재 checkout에서 추정하지 않는다.
export const normalizeAuditCodeVersion = (value: string | undefined): string | undefined => {
    const sha = value?.trim().toLowerCase();
    return sha && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha) && !/^0+$/.test(sha) ? sha : undefined;
};
