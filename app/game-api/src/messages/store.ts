import type { MessagePayload, MessageRecordDraft, MessageType } from '@sammo-ts/logic';

import type { DatabaseClient } from '../context.js';

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
    const rows = await db.$queryRaw<Array<{ id: number }>>`
        INSERT INTO message (mailbox, type, src, dest, time, valid_until, message)
        VALUES (
            ${draft.mailbox},
            ${draft.msgType},
            ${draft.srcId},
            ${draft.destId},
            ${draft.time},
            ${draft.validUntil},
            CAST(${JSON.stringify(draft.payload)} AS jsonb)
        )
        RETURNING id
    `;
    const id = rows[0]?.id;
    if (!id) {
        throw new Error('Failed to insert message row.');
    }
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
    const rows = await params.db.$queryRaw<MessageRow[]>`
        SELECT id, mailbox, type, src, dest, time, valid_until, message
        FROM message
        WHERE mailbox = ${params.mailbox}
            AND type = ${params.msgType}
            AND valid_until > NOW()
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
    const rows = await params.db.$queryRaw<MessageRow[]>`
        SELECT id, mailbox, type, src, dest, time, valid_until, message
        FROM message
        WHERE mailbox = ${params.mailbox}
            AND type = ${params.msgType}
            AND valid_until > NOW()
            AND id < ${params.toSeq}
        ORDER BY id DESC
        LIMIT ${params.limit}
    `;

    return rows.map(toMessageView);
};

export const fetchMessageById = async (db: DatabaseClient, id: number): Promise<StoredMessage | null> => {
    const rows = await db.$queryRaw<MessageRow[]>`
        SELECT id, mailbox, type, src, dest, time, valid_until, message
        FROM message
        WHERE id = ${id} AND valid_until > NOW()
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

export const invalidateMessages = async (db: DatabaseClient, ids: number[]): Promise<void> => {
    const uniqueIds = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
    if (uniqueIds.length === 0) return;
    await db.message.updateMany({
        where: { id: { in: uniqueIds } },
        data: { validUntil: new Date() },
    });
};
