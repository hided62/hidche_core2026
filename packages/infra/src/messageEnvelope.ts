import type { MessageRecordDraft } from '@sammo-ts/logic';

import { GamePrisma } from './gamePrisma.js';

export interface MessageGameContext {
    occurredGameTick: bigint;
    clockRevision: bigint;
    deadlineGeneration: bigint;
    expiresGameTick: bigint | null;
}

export type MessageEnvelopeDatabase = Pick<GamePrisma.TransactionClient, '$queryRaw'>;

const resolveActionType = (draft: MessageRecordDraft): string | null => {
    const option = draft.payload.option;
    if (!option || typeof option !== 'object' || Array.isArray(option)) return null;
    const action = Reflect.get(option, 'action');
    return typeof action === 'string' && action.trim() !== '' ? action : null;
};

/**
 * Persists a WALL_TIME message envelope and, only for an explicit actionable
 * payload, a separate GAME_TIME action row. PostgreSQL supplies the envelope
 * occurrence and delete deadline; caller clocks are compatibility projections.
 */
export const persistMessageEnvelope = async (
    db: MessageEnvelopeDatabase,
    draft: MessageRecordDraft,
    gameContext: MessageGameContext | null = null
): Promise<number> => {
    const actionType = resolveActionType(draft);
    if (actionType !== null && gameContext === null) {
        throw new Error(`Actionable message ${actionType} requires an authoritative game clock context.`);
    }

    const occurredGameTick = gameContext?.occurredGameTick ?? null;
    const legacyValidUntilTick = actionType === null ? null : gameContext!.expiresGameTick;
    const rows = await db.$queryRaw<Array<{ id: number }>>(GamePrisma.sql`
        WITH wall AS (
            SELECT CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AS now_wall
        ), inserted AS (
            INSERT INTO message (
                mailbox,
                type,
                src,
                dest,
                time,
                time_tick,
                valid_until,
                valid_until_tick,
                created_at_wall,
                delete_until_wall,
                occurred_game_tick,
                message
            )
            SELECT
                ${draft.mailbox},
                ${draft.msgType},
                ${draft.srcId},
                ${draft.destId},
                ${draft.time},
                ${occurredGameTick},
                ${draft.validUntil},
                ${legacyValidUntilTick},
                wall.now_wall,
                wall.now_wall + INTERVAL '5 minutes',
                ${occurredGameTick},
                CAST(${JSON.stringify(draft.payload)} AS jsonb)
            FROM wall
            RETURNING id
        ), action AS (
            INSERT INTO message_action (
                message_id,
                action_type,
                status,
                created_game_tick,
                expires_game_tick,
                clock_revision,
                deadline_generation
            )
            SELECT
                inserted.id,
                ${actionType},
                'PENDING',
                ${gameContext?.occurredGameTick ?? 0n},
                ${gameContext?.expiresGameTick ?? null},
                ${gameContext?.clockRevision ?? 0n},
                ${gameContext?.deadlineGeneration ?? 0n}
            FROM inserted
            WHERE ${actionType} IS NOT NULL
            RETURNING message_id
        )
        SELECT id FROM inserted
    `);
    const id = rows[0]?.id;
    if (!id) throw new Error('Failed to persist message envelope.');
    return id;
};
