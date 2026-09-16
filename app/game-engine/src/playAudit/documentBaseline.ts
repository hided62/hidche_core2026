import { asRecord } from '@sammo-ts/common';
import {
    hashAuditDiplomacyDocument,
    persistAuditDiplomacyEvents,
    projectAuditDocumentState,
    GamePrisma,
} from '@sammo-ts/infra';
import type { InMemoryTurnWorld } from '../turn/inMemoryWorld.js';

export const hasAuditDocumentBaseline = (world: InMemoryTurnWorld): boolean => {
    const state = world.getState();
    const { meta } = state;
    const serverId = meta.serverId;
    if (typeof serverId !== 'string' || !serverId.trim()) return true;
    const marker = asRecord(meta.playAuditDocuments);
    if (marker.serverId !== serverId) return false;
    if (
        marker.schemaVersion !== 1 ||
        typeof marker.documentCount !== 'number' ||
        !Number.isSafeInteger(marker.documentCount) ||
        marker.documentCount < 0 ||
        typeof marker.year !== 'number' ||
        !Number.isSafeInteger(marker.year) ||
        marker.year < 0 ||
        typeof marker.month !== 'number' ||
        !Number.isInteger(marker.month) ||
        marker.month < 1 ||
        marker.month > 12 ||
        marker.year * 12 + marker.month > state.currentYear * 12 + state.currentMonth ||
        typeof marker.tick !== 'number' ||
        !Number.isSafeInteger(marker.tick) ||
        marker.tick < 0 ||
        typeof marker.clockRevision !== 'number' ||
        !Number.isSafeInteger(marker.clockRevision) ||
        marker.clockRevision < 0 ||
        typeof marker.observedAt !== 'string' ||
        !Number.isFinite(Date.parse(marker.observedAt))
    )
        throw new Error('Invalid play audit document boundary');
    return true;
};

/** CLOCK lock을 잡은 startup transaction 안에서만 호출한다. 과거 문서 사건을 복원하지 않는다. */
export const persistAuditDocumentBaseline = async (
    db: GamePrisma.TransactionClient,
    world: InMemoryTurnWorld,
    observedAt: Date
): Promise<void> => {
    if (hasAuditDocumentBaseline(world)) return;
    const state = world.getState();
    const serverId = state.meta.serverId;
    if (typeof serverId !== 'string' || !serverId.trim()) return;
    const observedAtIso = observedAt.toISOString();
    const [identity] = await db.$queryRaw<Array<{ serverId: string | null }>>(GamePrisma.sql`
        SELECT meta->>'serverId' AS "serverId" FROM world_state WHERE id = ${state.id} FOR UPDATE
    `);
    if (identity?.serverId !== serverId) throw new Error('Play audit document baseline season changed');
    const clock = world.getGameClockState();
    let cursor = 0;
    let documentCount = 0;
    while (true) {
        // 문서 본문은 불변 참조의 해시에만 필요하다. 메모리에는 한 batch만 유지한다.
        const letters = await db.diplomacyLetter.findMany({
            where: { id: { gt: cursor } },
            orderBy: { id: 'asc' },
            take: 200,
            select: {
                id: true,
                srcNationId: true,
                destNationId: true,
                prevId: true,
                textBrief: true,
                textDetail: true,
                srcSignerId: true,
                destSignerId: true,
                state: true,
                aux: true,
                date: true,
            },
        });
        await persistAuditDiplomacyEvents(
            db,
            letters.map((letter) => ({
                schemaVersion: 1,
                serverId,
                srcNationId: letter.srcNationId,
                destNationId: letter.destNationId,
                category: 'DOCUMENT',
                source: 'BASELINE',
                eventType: 'LETTER_BASELINE',
                documentId: letter.id,
                documentHash: hashAuditDiplomacyDocument(letter),
                previousDocumentId: letter.prevId,
                year: state.currentYear,
                month: state.currentMonth,
                tick: BigInt(clock.tick),
                clockRevision: BigInt(clock.revision),
                executionId: 'document-baseline',
                ordinal: letter.id,
                requestId: null,
                inputSequence: null,
                actor: null,
                before: null,
                after: projectAuditDocumentState(letter),
            }))
        );
        documentCount += letters.length;
        if (letters.length < 200) break;
        cursor = letters[letters.length - 1]!.id;
    }
    world.updateWorldMeta({
        playAuditDocuments: {
            schemaVersion: 1,
            serverId,
            year: state.currentYear,
            month: state.currentMonth,
            tick: clock.tick,
            clockRevision: clock.revision,
            observedAt: observedAtIso,
            documentCount,
        },
    });
};
