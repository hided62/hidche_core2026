import type { InMemoryTurnWorld } from '../turn/inMemoryWorld.js';
import type { TurnDiplomacy } from '../turn/types.js';

/** 기존 월간 처리의 전후 값을 기록한다. 기본 TRADE 행 생성은 전이가 아니다. */
export const recordMonthlyAuditDiplomacy = (
    world: InMemoryTurnWorld,
    before: readonly TurnDiplomacy[],
    afterByKey: ReadonlyMap<string, TurnDiplomacy>
): void => {
    const state = world.getState();
    const serverId = state.meta.serverId;
    if (typeof serverId !== 'string' || !serverId.trim()) return;
    const clock = world.getGameClockState();
    const project = (entry: TurnDiplomacy) => ({ state: entry.state, term: entry.term, dead: entry.dead });
    let ordinal = 0;
    for (const entry of [...before].sort(
        (left, right) => left.fromNationId - right.fromNationId || left.toNationId - right.toNationId
    )) {
        const next = afterByKey.get(`${entry.fromNationId}:${entry.toNationId}`);
        if (!next) continue;
        const previousState = project(entry);
        const nextState = project(next);
        if (JSON.stringify(previousState) === JSON.stringify(nextState)) continue;
        world.queueAuditDiplomacy({
            schemaVersion: 1,
            serverId,
            srcNationId: entry.fromNationId,
            destNationId: entry.toNationId,
            category: 'RELATION',
            source: 'ENGINE',
            eventType: 'MONTHLY_RELATION_CHANGED',
            documentId: null,
            documentHash: null,
            previousDocumentId: null,
            year: state.currentYear,
            month: state.currentMonth,
            tick: BigInt(clock.tick),
            clockRevision: BigInt(clock.revision),
            executionId: `monthly:${state.currentYear}:${state.currentMonth}:${clock.revision}`,
            ordinal: ++ordinal,
            requestId: null,
            inputSequence: null,
            actor: null,
            before: previousState,
            after: nextState,
        });
    }
};
