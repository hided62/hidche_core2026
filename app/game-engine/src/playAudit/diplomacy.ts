import { asRecord } from '@sammo-ts/common';
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

/** 현재 로드된 관계를 도입 시 한 번만 고정한다. 과거 발생 원인/주체는 추정하지 않는다. */
export const initializeAuditDiplomacy = (world: InMemoryTurnWorld, observedAt = new Date()): boolean => {
    const state = world.getState();
    const serverId = state.meta.serverId;
    if (typeof serverId !== 'string' || !serverId.trim()) return false;
    const previous = asRecord(state.meta.playAuditDiplomacy);
    if (previous.serverId === serverId) {
        if (
            previous.schemaVersion !== 1 ||
            typeof previous.year !== 'number' ||
            previous.year < 0 ||
            !Number.isInteger(previous.year) ||
            !Number.isInteger(previous.month) ||
            typeof previous.month !== 'number' ||
            previous.month < 1 ||
            previous.month > 12 ||
            typeof previous.tick !== 'number' ||
            !Number.isSafeInteger(previous.tick) ||
            previous.tick < 0 ||
            typeof previous.clockRevision !== 'number' ||
            !Number.isSafeInteger(previous.clockRevision) ||
            previous.clockRevision < 0 ||
            typeof previous.relationCount !== 'number' ||
            !Number.isInteger(previous.relationCount) ||
            previous.relationCount < 0 ||
            previous.year * 12 + previous.month > state.currentYear * 12 + state.currentMonth ||
            typeof previous.observedAt !== 'string' ||
            !Number.isFinite(Date.parse(previous.observedAt))
        )
            throw new Error('Invalid play audit diplomacy boundary');
        return false;
    }
    const clock = world.getGameClockState();
    const observedAtIso = observedAt.toISOString();
    const relations = world
        .listDiplomacy()
        .filter((entry) => entry.fromNationId > 0 && entry.toNationId > 0)
        .sort((left, right) => left.fromNationId - right.fromNationId || left.toNationId - right.toNationId);
    for (const [index, entry] of relations.entries()) {
        world.queueAuditDiplomacy({
            schemaVersion: 1,
            serverId,
            srcNationId: entry.fromNationId,
            destNationId: entry.toNationId,
            category: 'RELATION',
            source: 'BASELINE',
            eventType: 'RELATION_BASELINE',
            documentId: null,
            documentHash: null,
            previousDocumentId: null,
            year: state.currentYear,
            month: state.currentMonth,
            tick: BigInt(clock.tick),
            clockRevision: BigInt(clock.revision),
            executionId: 'relation-baseline',
            ordinal: index + 1,
            requestId: null,
            inputSequence: null,
            actor: null,
            before: null,
            after: { state: entry.state, term: entry.term, dead: entry.dead },
        });
    }
    world.updateWorldMeta({
        playAuditDiplomacy: {
            schemaVersion: 1,
            serverId,
            year: state.currentYear,
            month: state.currentMonth,
            tick: clock.tick,
            clockRevision: clock.revision,
            observedAt: observedAtIso,
            relationCount: relations.length,
        },
    });
    return true;
};

/** 국가 생멸로 생성/제거된 관계를 기록한다. 행위자나 명령은 관측하지 못했다면 추정하지 않는다. */
export const recordNationAuditDiplomacy = (
    world: InMemoryTurnWorld,
    nationIds: readonly number[],
    relations: readonly TurnDiplomacy[],
    operation: 'CREATED' | 'REMOVED',
    observedTick?: number
): void => {
    const state = world.getState();
    const serverId = state.meta.serverId;
    if (typeof serverId !== 'string' || !serverId.trim()) return;
    const targets = new Set(nationIds.filter((id) => id > 0));
    const observed = relations
        .filter(
            (entry) =>
                entry.fromNationId > 0 &&
                entry.toNationId > 0 &&
                (targets.has(entry.fromNationId) || targets.has(entry.toNationId))
        )
        .sort((left, right) => left.fromNationId - right.fromNationId || left.toNationId - right.toNationId);
    if (!observed.length) return;
    // 전역 순번은 실행 identity에만 사용한다. 한 사건 묶음 안의 순서는 방향별 local ordinal이다.
    const executionId = `nation-relations:${world.nextAuditOrdinal()}`;
    const clock = world.getGameClockState();
    for (const [index, entry] of observed.entries()) {
        const value = { state: entry.state, term: entry.term, dead: entry.dead };
        world.queueAuditDiplomacy({
            schemaVersion: 1,
            serverId,
            srcNationId: entry.fromNationId,
            destNationId: entry.toNationId,
            category: 'RELATION',
            source: 'ENGINE',
            eventType: `NATION_RELATION_${operation}`,
            documentId: null,
            documentHash: null,
            previousDocumentId: null,
            year: state.currentYear,
            month: state.currentMonth,
            tick: BigInt(observedTick ?? clock.tick),
            clockRevision: BigInt(clock.revision),
            executionId,
            ordinal: index + 1,
            requestId: null,
            inputSequence: null,
            actor: null,
            before: operation === 'REMOVED' ? value : null,
            after: operation === 'CREATED' ? value : null,
        });
    }
};
