import {
    enqueuePrivateMessageWebPush,
    GamePrisma,
    persistMessageEnvelope,
    type MessageGameContext,
} from '@sammo-ts/infra';
import type { MessagePayload, MessageRecordDraft, MessageType } from '@sammo-ts/logic';

import type { DatabaseClient } from '../context.js';
import { loadCurrentGameTime } from '../services/gameClock.js';

export interface MessageView {
    id: number;
    msgType: MessageType;
    src: MessagePayload['src'];
    dest: MessagePayload['dest'] | null;
    text: string;
    option?: MessagePayload['option'] | null;
    time: string;
}

interface MessageRow {
    id: number;
    mailbox: number;
    type: MessageType;
    src: number;
    dest: number;
    time: Date;
    created_at_wall: Date;
    action_status: string | null;
    expires_game_tick: bigint | null;
    message: unknown;
}

export interface StoredMessage {
    id: number;
    mailbox: number;
    msgType: MessageType;
    time: Date;
    payload: MessagePayload;
}

const parsePayload = (value: unknown): MessagePayload => {
    if (typeof value === 'string') {
        return JSON.parse(value) as MessagePayload;
    }
    return value as MessagePayload;
};

const formatMessageTime = (value: Date): string => {
    const pad = (input: number) => input.toString().padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(
        value.getDate()
    )} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
};

const toMessageView = (row: MessageRow, currentGameTick: bigint | null): MessageView => {
    const payload = parsePayload(row.message);
    const actionStatus = typeof row.action_status === 'string' ? row.action_status : null;
    const actionUnavailable =
        actionStatus !== null &&
        (actionStatus !== 'PENDING' ||
            (row.expires_game_tick !== null && currentGameTick !== null && row.expires_game_tick <= currentGameTick));
    return {
        id: row.id,
        msgType: row.type,
        src: payload.src,
        dest: row.type === 'public' ? null : payload.dest,
        text: payload.text,
        option:
            actionUnavailable && payload.option && typeof payload.option === 'object'
                ? { ...payload.option, used: true, invalid: true }
                : (payload.option ?? null),
        time: formatMessageTime(new Date(row.created_at_wall ?? row.time)),
    };
};

export const insertMessage = async (db: DatabaseClient, draft: MessageRecordDraft): Promise<number> => {
    const action = draft.payload.option && Reflect.get(draft.payload.option, 'action');
    let gameContext: MessageGameContext | null = null;
    if (typeof action === 'string' && action !== '') {
        const gameTime = await loadCurrentGameTime(db);
        if (
            gameTime.tick === null ||
            gameTime.revision === null ||
            gameTime.revision === undefined ||
            gameTime.deadlineGeneration === null ||
            gameTime.deadlineGeneration === undefined
        ) {
            throw new Error(`Actionable message ${action} requires an initialized game clock.`);
        }
        let expiresGameTick: bigint | null = null;
        if (draft.validUntil.getUTCFullYear() < 9000) {
            const expires = gameTime.dateToTick(draft.validUntil);
            if (expires === null) throw new Error(`Actionable message ${action} requires a GAME_TIME deadline.`);
            expiresGameTick = BigInt(expires);
        }
        gameContext = {
            occurredGameTick: BigInt(gameTime.tick),
            clockRevision: BigInt(gameTime.revision),
            deadlineGeneration: BigInt(gameTime.deadlineGeneration),
            expiresGameTick,
        };
    }
    const id = await persistMessageEnvelope(db, draft, gameContext);
    await enqueuePrivateMessageWebPush(db, draft, id);
    return id;
};

const loadMessageViews = async (db: DatabaseClient, rows: MessageRow[]): Promise<MessageView[]> => {
    if (!rows.some((row) => typeof row.action_status === 'string')) return rows.map((row) => toMessageView(row, null));
    const gameTime = await loadCurrentGameTime(db);
    const currentGameTick = gameTime.tick === null ? null : BigInt(gameTime.tick);
    return rows.map((row) => toMessageView(row, currentGameTick));
};

export const fetchMessagesFromMailbox = async (params: {
    db: DatabaseClient;
    mailbox: number;
    msgType: MessageType;
    limit: number;
    fromSeq: number;
}): Promise<MessageView[]> => {
    const fromSeq = Math.max(params.fromSeq, 0);
    const rows = await params.db.$queryRaw<MessageRow[]>`
        SELECT m.id, m.mailbox, m.type, m.src, m.dest, m.time,
               m.created_at_wall, m.message,
               ma.status AS action_status, ma.expires_game_tick
        FROM message m
        LEFT JOIN message_action ma ON ma.message_id = m.id
        WHERE m.mailbox = ${params.mailbox}
            AND m.type = ${params.msgType}
            AND m.id >= ${fromSeq}
        ORDER BY m.id DESC
        LIMIT ${params.limit}
    `;

    return loadMessageViews(params.db, rows);
};

export const fetchOldMessagesFromMailbox = async (params: {
    db: DatabaseClient;
    mailbox: number;
    msgType: MessageType;
    toSeq: number;
    limit: number;
}): Promise<MessageView[]> => {
    const rows = await params.db.$queryRaw<MessageRow[]>`
        SELECT m.id, m.mailbox, m.type, m.src, m.dest, m.time,
               m.created_at_wall, m.message,
               ma.status AS action_status, ma.expires_game_tick
        FROM message m
        LEFT JOIN message_action ma ON ma.message_id = m.id
        WHERE m.mailbox = ${params.mailbox}
            AND m.type = ${params.msgType}
            AND m.id < ${params.toSeq}
        ORDER BY m.id DESC
        LIMIT ${params.limit}
    `;

    return loadMessageViews(params.db, rows);
};

export const fetchMessageById = async (db: DatabaseClient, id: number): Promise<StoredMessage | null> => {
    const rows = await db.$queryRaw<MessageRow[]>`
        SELECT m.id, m.mailbox, m.type, m.src, m.dest, m.time,
               m.created_at_wall, m.message,
               ma.status AS action_status, ma.expires_game_tick
        FROM message m
        LEFT JOIN message_action ma ON ma.message_id = m.id
        WHERE m.id = ${id}
        LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    return {
        id: row.id,
        mailbox: row.mailbox,
        msgType: row.type,
        time: new Date(row.created_at_wall ?? row.time),
        payload: parsePayload(row.message),
    };
};

export const fetchMessageByIdForUpdate = async (db: DatabaseClient, id: number): Promise<StoredMessage | null> => {
    const gameTime = await loadCurrentGameTime(db);
    if (gameTime.tick === null) throw new Error('Actionable message response requires an initialized game clock.');
    const rows = await db.$queryRaw<MessageRow[]>`
        SELECT m.id, m.mailbox, m.type, m.src, m.dest, m.time,
               m.created_at_wall, m.message,
               ma.status AS action_status, ma.expires_game_tick
        FROM message m
        JOIN message_action ma ON ma.message_id = m.id
        JOIN world_state world ON TRUE
        WHERE m.id = ${id}
          AND ma.status = 'PENDING'
          AND (ma.expires_game_tick IS NULL OR ma.expires_game_tick > ${BigInt(gameTime.tick)})
          AND world.clock_phase IN ('RUNNING', 'MANUAL')
          AND ma.clock_revision = world.clock_revision
          AND ma.deadline_generation = world.deadline_generation
        LIMIT 1
        FOR UPDATE OF m, ma, world
    `;
    const row = rows[0];
    if (!row) return null;
    return {
        id: row.id,
        mailbox: row.mailbox,
        msgType: row.type,
        time: new Date(row.created_at_wall ?? row.time),
        payload: parsePayload(row.message),
    };
};

export const invalidateMessages = async (db: DatabaseClient, ids: number[]): Promise<void> => {
    const uniqueIds = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
    if (uniqueIds.length === 0) return;
    const gameTime = await loadCurrentGameTime(db);
    if (gameTime.tick === null) throw new Error('Actionable message invalidation requires an initialized game clock.');
    await db.messageAction.updateMany({
        where: { messageId: { in: uniqueIds }, status: 'PENDING' },
        data: { status: 'RESOLVED', resolvedGameTick: BigInt(gameTime.tick) },
    });
    await db.message.updateMany({
        where: { id: { in: uniqueIds } },
        data: {
            validUntil: gameTime.now,
            validUntilTick: BigInt(gameTime.tick),
        },
    });
};

export const tombstoneMessages = async (db: DatabaseClient, ids: number[]): Promise<void> => {
    const uniqueIds = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
    if (uniqueIds.length === 0) return;

    await db.$executeRaw(
        GamePrisma.sql`
            UPDATE message
            SET message = jsonb_set(
                jsonb_set(message, '{text}', to_jsonb(${'삭제된 메시지입니다.'}::text), true),
                '{option}',
                (
                    CASE
                        WHEN jsonb_typeof(message->'option') = 'object' THEN message->'option'
                        ELSE '{}'::jsonb
                    END
                ) || jsonb_build_object('invalid', true),
                true
            ),
                tombstoned_at_wall = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
            WHERE id IN (${GamePrisma.join(uniqueIds)})
        `
    );
};

export const tombstoneMessagesWithinDeleteWindow = async (
    db: DatabaseClient,
    authorityMessageId: number,
    ids: number[]
): Promise<number[]> => {
    const uniqueIds = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
    if (uniqueIds.length === 0) return [];
    const rows = await db.$queryRaw<Array<{ id: number }>>(GamePrisma.sql`
        WITH wall AS (
            SELECT CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AS now_wall
        ), authority AS (
            SELECT m.id
            FROM message m, wall
            WHERE m.id = ${authorityMessageId}
              AND m.tombstoned_at_wall IS NULL
              AND m.delete_until_wall >= wall.now_wall
            FOR UPDATE
        )
        UPDATE message m
        SET message = jsonb_set(
                jsonb_set(m.message, '{text}', to_jsonb(${'삭제된 메시지입니다.'}::text), true),
                '{option}',
                (
                    CASE
                        WHEN jsonb_typeof(m.message->'option') = 'object' THEN m.message->'option'
                        ELSE '{}'::jsonb
                    END
                ) || jsonb_build_object('invalid', true),
                true
            ),
            tombstoned_at_wall = wall.now_wall
        FROM wall
        WHERE m.id IN (${GamePrisma.join(uniqueIds)})
          AND EXISTS (SELECT 1 FROM authority)
        RETURNING m.id
    `);
    return rows.map(({ id }) => id).sort((left, right) => left - right);
};
