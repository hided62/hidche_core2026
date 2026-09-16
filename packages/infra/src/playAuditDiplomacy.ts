import { createHash } from 'node:crypto';
import { GamePrisma, type GamePrismaClient } from './gamePrisma.js';

export interface AuditDiplomacyEventDraft {
    schemaVersion: 1;
    serverId: string;
    srcNationId: number;
    destNationId: number;
    category: 'DOCUMENT' | 'RELATION';
    source: 'API' | 'ENGINE' | 'BASELINE';
    eventType: string;
    documentId: number | null;
    documentHash: string | null;
    previousDocumentId: number | null;
    year: number;
    month: number;
    tick: bigint | null;
    clockRevision: bigint | null;
    executionId: string;
    ordinal: number;
    requestId: string | null;
    inputSequence: bigint | null;
    actor: Record<string, unknown> | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
}

export const hashAuditDiplomacy = (value: unknown): string =>
    createHash('sha256')
        .update(
            JSON.stringify(value, (_key, item: unknown) => {
                if (typeof item === 'bigint') return item.toString();
                if (item && typeof item === 'object' && !Array.isArray(item))
                    return Object.fromEntries(
                        Object.entries(item).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
                    );
                return item;
            })
        )
        .digest('hex');

/** 본문은 불변 문서 행을 참조한다. event별로 HTML을 복제하지 않는다. */
export const hashAuditDiplomacyDocument = (letter: {
    id: number;
    srcNationId: number;
    destNationId: number;
    prevId: number | null;
    textBrief: string;
    textDetail: string;
    srcSignerId: number;
    date: Date;
}): string =>
    hashAuditDiplomacy({
        id: letter.id,
        srcNationId: letter.srcNationId,
        destNationId: letter.destNationId,
        prevId: letter.prevId,
        textBrief: letter.textBrief,
        textDetail: letter.textDetail,
        srcSignerId: letter.srcSignerId,
        date: letter.date.toISOString(),
    });

export const persistAuditDiplomacyEvents = async (
    db: Pick<GamePrismaClient, 'playAuditDiplomacyEvent'>,
    events: readonly AuditDiplomacyEventDraft[]
): Promise<void> => {
    const json = (value: Record<string, unknown> | null) =>
        value === null ? GamePrisma.DbNull : (JSON.parse(JSON.stringify(value)) as GamePrisma.InputJsonValue);
    for (let offset = 0; offset < events.length; offset += 200) {
        const batch = events.slice(offset, offset + 200).map((event) => ({
            ...event,
            id: hashAuditDiplomacy([event.serverId, event.executionId, event.ordinal]),
            nationA: Math.min(event.srcNationId, event.destNationId),
            nationB: Math.max(event.srcNationId, event.destNationId),
            actor: json(event.actor),
            before: json(event.before),
            after: json(event.after),
            hash: hashAuditDiplomacy(event),
        }));
        await db.playAuditDiplomacyEvent.createMany({ data: batch, skipDuplicates: true });
        const saved = await db.playAuditDiplomacyEvent.findMany({
            where: { id: { in: batch.map((event) => event.id) } },
            select: { id: true, hash: true },
        });
        const hashes = new Map(saved.map((row) => [row.id, row.hash]));
        if (batch.some((event) => hashes.get(event.id) !== event.hash))
            throw new Error('Play audit diplomacy replay payload conflict');
    }
};
