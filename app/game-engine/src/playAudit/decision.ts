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
