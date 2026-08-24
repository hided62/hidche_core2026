import { MAX_SAFE_GAME_TICK } from '@sammo-ts/common';
import { enqueuePrivateMessageWebPush, GamePrisma } from '@sammo-ts/infra';
import type { MessagePayload, MessageRecordDraft, MessageType } from '@sammo-ts/logic';

import type { DatabaseClient } from '../context.js';
import { loadCurrentGameTime, type CurrentGameTime } from '../services/gameClock.js';

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
    valid_until: Date;
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

const messageValidityPredicate = (gameTime: CurrentGameTime) => {
    if (gameTime.tick === null) {
        // A legacy or partially migrated profile has no authoritative logical
        // tick. Rows that already carry a tick still need the wall-time
        // fallback used by the clock migration.
        return GamePrisma.sql`valid_until > ${gameTime.now}`;
    }
    return GamePrisma.sql`(
        (valid_until_tick IS NOT NULL AND valid_until_tick > ${BigInt(gameTime.tick)})
        OR (valid_until_tick IS NULL AND valid_until > ${gameTime.now})
    )`;
};

const toMessageView = (row: MessageRow): MessageView => {
    const payload = parsePayload(row.message);
    return {
        id: row.id,
        msgType: row.type,
        src: payload.src,
        dest: row.type === 'public' ? null : payload.dest,
        text: payload.text,
        option: payload.option ?? null,
        time: formatMessageTime(new Date(row.time)),
    };
};

export const insertMessage = async (db: DatabaseClient, draft: MessageRecordDraft): Promise<number> => {
    const gameTime = await loadCurrentGameTime(db);
    const toTickOrNull = (date: Date): bigint | null => {
        // Ref represents its unlimited 9999-12-31 message lifetime with the
        // largest safe game tick instead of falling back to a wall-clock-only row.
        if (date.getUTCFullYear() >= 9000) {
            return BigInt(MAX_SAFE_GAME_TICK);
        }
        try {
            const tick = gameTime.dateToTick(date);
            return tick === null ? null : BigInt(tick);
        } catch {
            return null;
        }
    };
    const rows = await db.$queryRaw<Array<{ id: number }>>`
        INSERT INTO message (mailbox, type, src, dest, time, time_tick, valid_until, valid_until_tick, message)
        VALUES (
            ${draft.mailbox},
            ${draft.msgType},
            ${draft.srcId},
            ${draft.destId},
            ${draft.time},
            ${toTickOrNull(draft.time)},
            ${draft.validUntil},
            ${toTickOrNull(draft.validUntil)},
            CAST(${JSON.stringify(draft.payload)} AS jsonb)
        )
        RETURNING id
    `;
    const id = rows[0]?.id;
    if (!id) {
        throw new Error('Failed to insert message row.');
    }
    await enqueuePrivateMessageWebPush(db, draft, id);
    return id;
};

export const fetchMessagesFromMailbox = async (params: {
    db: DatabaseClient;
    mailbox: number;
    msgType: MessageType;
    limit: number;
    fromSeq: number;
}): Promise<MessageView[]> => {
    const fromSeq = Math.max(params.fromSeq, 0);
    const gameTime = await loadCurrentGameTime(params.db);
    const rows = await params.db.$queryRaw<MessageRow[]>`
        SELECT id, mailbox, type, src, dest, time, valid_until, message
        FROM message
        WHERE mailbox = ${params.mailbox}
            AND type = ${params.msgType}
            AND ${messageValidityPredicate(gameTime)}
            AND id >= ${fromSeq}
        ORDER BY id DESC
        LIMIT ${params.limit}
    `;

    return rows.map(toMessageView);
};

export const fetchOldMessagesFromMailbox = async (params: {
    db: DatabaseClient;
    mailbox: number;
    msgType: MessageType;
    toSeq: number;
    limit: number;
}): Promise<MessageView[]> => {
    const gameTime = await loadCurrentGameTime(params.db);
    const rows = await params.db.$queryRaw<MessageRow[]>`
        SELECT id, mailbox, type, src, dest, time, valid_until, message
        FROM message
        WHERE mailbox = ${params.mailbox}
            AND type = ${params.msgType}
            AND ${messageValidityPredicate(gameTime)}
            AND id < ${params.toSeq}
        ORDER BY id DESC
        LIMIT ${params.limit}
    `;

    return rows.map(toMessageView);
};

export const fetchMessageById = async (db: DatabaseClient, id: number): Promise<StoredMessage | null> => {
    const gameTime = await loadCurrentGameTime(db);
    const rows = await db.$queryRaw<MessageRow[]>`
        SELECT id, mailbox, type, src, dest, time, valid_until, message
        FROM message
        WHERE id = ${id}
          AND ${messageValidityPredicate(gameTime)}
        LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    return {
        id: row.id,
        mailbox: row.mailbox,
        msgType: row.type,
        time: new Date(row.time),
        payload: parsePayload(row.message),
    };
};

export const fetchMessageByIdForUpdate = async (db: DatabaseClient, id: number): Promise<StoredMessage | null> => {
    const gameTime = await loadCurrentGameTime(db);
    const rows = await db.$queryRaw<MessageRow[]>`
        SELECT id, mailbox, type, src, dest, time, valid_until, message
        FROM message
        WHERE id = ${id}
          AND ${messageValidityPredicate(gameTime)}
        LIMIT 1
        FOR UPDATE
    `;
    const row = rows[0];
    if (!row) return null;
    return {
        id: row.id,
        mailbox: row.mailbox,
        msgType: row.type,
        time: new Date(row.time),
        payload: parsePayload(row.message),
    };
};

export const invalidateMessages = async (db: DatabaseClient, ids: number[]): Promise<void> => {
    const uniqueIds = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
    if (uniqueIds.length === 0) return;
    const gameTime = await loadCurrentGameTime(db);
    await db.message.updateMany({
        where: { id: { in: uniqueIds } },
        data: {
            validUntil: gameTime.now,
            // A partially migrated profile can still carry a legacy logical
            // sentinel even while no authoritative clock exists. Replace it
            // with an already-expired logical tick when expiring by wall time;
            // NULL would fall back to the wall timestamp after clock recovery
            // and could make the handled message visible again.
            validUntilTick: gameTime.tick === null ? 0n : BigInt(gameTime.tick),
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
            )
            WHERE id IN (${GamePrisma.join(uniqueIds)})
        `
    );
};
