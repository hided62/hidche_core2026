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

export interface AuditDiplomacyAction {
    actionKey: string;
    kind: 'nation' | 'general';
    actionOrdinal: number;
    actor: {
        generalId: number;
        userId: string | null;
        name: string;
        nationId: number;
        officerLevel: number;
        npcState: number;
    };
}

export const recordTurnAuditDiplomacy = (
    world: InMemoryTurnWorld,
    before: TurnDiplomacy,
    after: TurnDiplomacy,
    action: AuditDiplomacyAction,
    turn: { generalId: number; tick: number; ordinal: number }
): void => {
    const state = world.getState();
    const serverId = state.meta.serverId;
    if (typeof serverId !== 'string' || !serverId.trim()) return;
    const previousState = { state: before.state, term: before.term, dead: before.dead };
    const nextState = { state: after.state, term: after.term, dead: after.dead };
    if (JSON.stringify(previousState) === JSON.stringify(nextState)) return;
    const clock = world.getGameClockState();
    world.queueAuditDiplomacy({
        schemaVersion: 1,
        serverId,
        srcNationId: before.fromNationId,
        destNationId: before.toNationId,
        category: 'RELATION',
        source: 'ENGINE',
        eventType: 'TURN_RELATION_CHANGED',
        documentId: null,
        documentHash: null,
        previousDocumentId: null,
        year: state.currentYear,
        month: state.currentMonth,
        tick: BigInt(turn.tick),
        clockRevision: BigInt(clock.revision),
        executionId: `turn:${turn.generalId}:${turn.tick}:${clock.revision}`,
        ordinal: turn.ordinal,
        requestId: null,
        inputSequence: null,
        actor: { ...action.actor, actionKey: action.actionKey, kind: action.kind, actionOrdinal: action.actionOrdinal },
        before: previousState,
        after: nextState,
    });
};
