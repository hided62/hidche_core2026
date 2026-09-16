import { asRecord, GameClock, inferClockPhase, parseGameClockPhase, readTurnRecovery } from '@sammo-ts/common';
import {
    GamePrisma,
    hashAuditDiplomacyDocument,
    persistAuditDiplomacyEvents,
    readTurnRuntimeReady,
    type AuditDiplomacyEventDraft,
} from '@sammo-ts/infra';
import type { GameApiContext, GeneralRow } from '../context.js';

type Letter = GamePrisma.DiplomacyLetterGetPayload<Record<string, never>>;
type DocumentAction =
    | 'LETTER_PROPOSED'
    | 'LETTER_REPLACED'
    | 'LETTER_ACCEPTED'
    | 'LETTER_REJECTED'
    | 'LETTER_WITHDRAWN'
    | 'LETTER_DESTROY_REQUESTED'
    | 'LETTER_DESTROYED';

export const projectAuditDocumentState = (letter: Letter): Record<string, unknown> => {
    const aux = asRecord(letter.aux);
    const src = asRecord(aux.src);
    const dest = asRecord(aux.dest);
    const reason = asRecord(aux.reason);
    return {
        state: letter.state,
        srcSignerId: letter.srcSignerId,
        destSignerId: letter.destSignerId,
        srcNationName: typeof src.nationName === 'string' ? src.nationName : null,
        destNationName: typeof dest.nationName === 'string' ? dest.nationName : null,
        srcSignerName: typeof src.generalName === 'string' ? src.generalName : null,
        destSignerName: typeof dest.generalName === 'string' ? dest.generalName : null,
        stateOption: typeof aux.state_opt === 'string' ? aux.state_opt : null,
        reason: typeof reason.reason === 'string' ? reason.reason : null,
        reasonAction: typeof reason.action === 'string' ? reason.action : null,
        reasonActorId: typeof reason.who === 'number' ? reason.who : null,
    };
};

interface AuditCoordinateRow {
    serverId: string | null;
    year: number;
    month: number;
    wallNow: Date;
    clockBaseTime: Date | null;
    clockTick: bigint | null;
    clockMode: string;
    clockWallAnchor: Date | null;
    clockPhase: string;
    clockRevision: bigint;
    clockRecoveryStartTick: bigint | null;
    clockRecoveryEndTick: bigint | null;
    clockRecoveryStartWallAt: Date | null;
    tickSeconds: number;
}

/** API 입력 transaction의 기존 clock fence 안에서 작은 시계/기수 투영만 읽는다. */
const readCoordinate = async (ctx: GameApiContext) => {
    const [row] = await ctx.db.$queryRaw<AuditCoordinateRow[]>(GamePrisma.sql`
        SELECT meta->>'serverId' AS "serverId", current_year AS year, current_month AS month,
               CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AS "wallNow",
               clock_base_time AS "clockBaseTime", clock_tick AS "clockTick", clock_mode AS "clockMode",
               clock_wall_anchor AS "clockWallAnchor", clock_phase AS "clockPhase", clock_revision AS "clockRevision",
               clock_recovery_start_tick AS "clockRecoveryStartTick", clock_recovery_end_tick AS "clockRecoveryEndTick",
               clock_recovery_start_wall_at AS "clockRecoveryStartWallAt", tick_seconds AS "tickSeconds"
        FROM world_state ORDER BY id LIMIT 1
    `);
    if (!row?.serverId?.trim()) return null;
    let tick: bigint | null = null;
    if (row.clockBaseTime && row.clockTick !== null && row.clockWallAnchor) {
        const clockTick = Number(row.clockTick);
        const revision = Number(row.clockRevision);
        if (!Number.isSafeInteger(clockTick) || !Number.isSafeInteger(revision))
            throw new Error('Play audit diplomacy clock outside safe integer range');
        const mode = row.clockMode === 'manual' ? 'manual' : 'realtime';
        const phase = row.clockPhase ? parseGameClockPhase(row.clockPhase) : inferClockPhase(mode);
        const clock = new GameClock({
            baseTime: row.clockBaseTime,
            tick: clockTick,
            mode,
            wallAnchor: row.clockWallAnchor,
            recovery: readTurnRecovery(row),
            turnSeconds: row.tickSeconds,
            phase,
            revision,
        });
        const ready =
            phase !== 'RUNNING' || mode !== 'realtime' || (await readTurnRuntimeReady(ctx.db, row.clockRevision));
        tick = BigInt(ready ? clock.nowTick(row.wallNow) : clock.tick);
    }
    return {
        serverId: row.serverId,
        year: row.year,
        month: row.month,
        tick,
        clockRevision: row.clockRevision,
        wallAt: row.wallNow,
    };
};

export const createDiplomacyDocumentAudit = (ctx: GameApiContext, actor: GeneralRow, permission: number) => {
    const changes: {
        letter: Letter;
        before: Record<string, unknown> | null;
        after: Record<string, unknown>;
        eventType: DocumentAction;
    }[] = [];
    return {
        record: (letter: Letter, before: Record<string, unknown> | null, eventType: DocumentAction) => {
            if (!ctx.auditInput) return;
            changes.push({ letter, before, after: projectAuditDocumentState(letter), eventType });
        },
        flush: async (): Promise<void> => {
            // 무transaction legacy unit fixture에는 입력 원장 identity를 꾸며 넣지 않는다.
            const input = ctx.auditInput;
            if (!input || !changes.length) return;
            if (input.actorUserId !== actor.userId || input.actorUserId !== ctx.auth?.user.id)
                throw new Error('Play audit diplomacy actor mismatch');
            const coordinate = await readCoordinate(ctx);
            if (!coordinate) return;
            const events: AuditDiplomacyEventDraft[] = changes.map((change, index) => ({
                schemaVersion: 1,
                serverId: coordinate.serverId,
                srcNationId: change.letter.srcNationId,
                destNationId: change.letter.destNationId,
                category: 'DOCUMENT',
                source: 'API',
                eventType: change.eventType,
                documentId: change.letter.id,
                documentHash: hashAuditDiplomacyDocument(change.letter),
                previousDocumentId: change.letter.prevId,
                year: coordinate.year,
                month: coordinate.month,
                tick: coordinate.tick,
                clockRevision: coordinate.clockRevision,
                executionId: `api:${input.requestId}`,
                ordinal: index + 1,
                requestId: input.requestId,
                inputSequence: input.sequence,
                actor: {
                    userId: actor.userId,
                    generalId: actor.id,
                    name: actor.name,
                    nationId: actor.nationId,
                    officerLevel: actor.officerLevel,
                    npcState: actor.npcState,
                    permission,
                },
                before: change.before,
                after: change.after,
            }));
            await persistAuditDiplomacyEvents(ctx.db, events);
        },
    };
};
