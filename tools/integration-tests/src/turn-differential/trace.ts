import {
    closeTurnSnapshotSelectorOverCreatedEntities,
    type CanonicalTurnCommandTrace,
    type TurnSnapshotSelector,
} from './canonical.js';
import { readCoreDatabaseEntityIds, readCoreDatabaseSnapshot } from './databaseSnapshot.js';

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
    const [before, entityIdsBefore] = await Promise.all([
        readCoreDatabaseSnapshot(databaseUrl, request.observe),
        readCoreDatabaseEntityIds(databaseUrl),
    ]);
    const result = await execute();
    const entityIdsAfter = await readCoreDatabaseEntityIds(databaseUrl);
    const afterSelector = closeTurnSnapshotSelectorOverCreatedEntities(
        request.observe,
        entityIdsBefore,
        entityIdsAfter
    );
    const after = await readCoreDatabaseSnapshot(databaseUrl, {
        ...afterSelector,
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
