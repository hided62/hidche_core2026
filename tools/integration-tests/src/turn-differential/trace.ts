import type { CanonicalTurnCommandTrace, TurnSnapshotSelector } from './canonical.js';
import { readCoreDatabaseSnapshot } from './databaseSnapshot.js';

export interface CoreTurnTraceRequest {
    kind: 'general' | 'nation';
    actorGeneralId: number;
    action: string;
    args: unknown;
    observe: TurnSnapshotSelector;
}

export const captureCoreDatabaseTurnTrace = async (
    databaseUrl: string,
    request: CoreTurnTraceRequest,
    execute: () => Promise<{
        outcome?: unknown;
        rng?: CanonicalTurnCommandTrace['rng'];
    }>
): Promise<CanonicalTurnCommandTrace> => {
    const before = await readCoreDatabaseSnapshot(databaseUrl, request.observe);
    const result = await execute();
    const after = await readCoreDatabaseSnapshot(databaseUrl, {
        ...request.observe,
        logAfterId: request.observe.logAfterId ?? before.watermarks.logId,
        messageAfterId: request.observe.messageAfterId ?? before.watermarks.messageId,
    });
    return {
        schemaVersion: 1,
        engine: 'core2026',
        execution: {
            kind: request.kind,
            actorGeneralId: request.actorGeneralId,
            action: request.action,
            args: request.args,
            seedDomain: request.kind === 'general' ? 'generalCommand' : 'nationCommand',
            outcome: result.outcome,
        },
        before,
        after,
        rng: result.rng ?? [],
    };
};
