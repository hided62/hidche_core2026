export type MessageType = 'public' | 'private' | 'national' | 'diplomacy';

export const MESSAGE_MAILBOX_PUBLIC = 9999;
export const MESSAGE_MAILBOX_NATIONAL_BASE = 9000;
export const DEFAULT_MESSAGE_SHARED_ICON_BASE_URL = 'https://sam-image.hided.net/icons';

export interface MessageIconSource {
    picture?: unknown;
    imageServer?: unknown;
    meta?: Record<string, unknown>;
}

/**
 * Match Ref GetImageURL for message payloads. Shared icons are absolute;
 * user icons retain the legacy d_pic marker consumed by the frontend.
 */
export const resolveMessageTargetIcon = (
    source: MessageIconSource | null = null,
    sharedIconBaseUrl = DEFAULT_MESSAGE_SHARED_ICON_BASE_URL
): string => {
    const rawPicture = source?.picture ?? source?.meta?.picture;
    const picture =
        (typeof rawPicture === 'string' && rawPicture.trim() !== '') || typeof rawPicture === 'number'
            ? String(rawPicture)
            : 'default.jpg';
    const imageServer = source?.imageServer ?? source?.meta?.imageServer;
    if (typeof imageServer === 'number' && imageServer !== 0) {
        return `d_pic/${picture}`;
    }
    return `${sharedIconBaseUrl.replace(/\/+$/u, '')}/${picture}`;
};

export interface MessageTarget {
    generalId: number;
    generalName: string;
    nationId: number;
    nationName: string;
    color: string;
    icon: string;
}

export type MessageOption = Record<string, unknown>;

export interface MessageDraft {
    msgType: MessageType;
    src: MessageTarget;
    dest: MessageTarget;
    text: string;
    time: Date;
    validUntil: Date;
    option?: MessageOption | null;
    /** Ref Message::send(true): persist only the receiver copy. */
    sendDestOnly?: boolean;
}

export interface MessagePayload {
    src: MessageTarget;
    dest: MessageTarget;
    text: string;
    option?: MessageOption | null;
}

export interface MessageRecordDraft {
    mailbox: number;
    msgType: MessageType;
    srcId: number;
    destId: number;
    time: Date;
    validUntil: Date;
    payload: MessagePayload;
}

export interface MessageStore {
    insertMessage(draft: MessageRecordDraft): Promise<number>;
}

const isValidMailbox = (mailbox: number): boolean => mailbox > 0 && mailbox <= MESSAGE_MAILBOX_PUBLIC;

const resolveReceiverMailbox = (draft: MessageDraft): number => {
    switch (draft.msgType) {
        case 'public':
            return MESSAGE_MAILBOX_PUBLIC;
        case 'national':
        case 'diplomacy':
            return MESSAGE_MAILBOX_NATIONAL_BASE + draft.dest.nationId;
        case 'private':
            return draft.dest.generalId;
    }
};

const resolveSenderMailbox = (draft: MessageDraft): number | null => {
    switch (draft.msgType) {
        case 'public':
            return null;
        case 'private':
            return draft.src.generalId !== draft.dest.generalId ? draft.src.generalId : null;
        case 'national':
            return draft.src.nationId !== draft.dest.nationId
                ? MESSAGE_MAILBOX_NATIONAL_BASE + draft.src.nationId
                : null;
        case 'diplomacy':
            return MESSAGE_MAILBOX_NATIONAL_BASE + draft.src.nationId;
    }
};

const buildPayload = (draft: MessageDraft, optionOverride?: MessageOption | null): MessagePayload => ({
    src: draft.src,
    dest: draft.dest,
    text: draft.text,
    option: optionOverride !== undefined ? optionOverride : (draft.option ?? {}),
});

const buildRecord = (
    draft: MessageDraft,
    mailbox: number,
    optionOverride?: MessageOption | null
): MessageRecordDraft => {
    const payload = buildPayload(draft, optionOverride);
    let srcId = draft.src.generalId;
    let destId = draft.dest.generalId;

    if (draft.msgType === 'public') {
        destId = MESSAGE_MAILBOX_PUBLIC;
    } else if (draft.msgType === 'national' || draft.msgType === 'diplomacy') {
        srcId = MESSAGE_MAILBOX_NATIONAL_BASE + draft.src.nationId;
        destId = MESSAGE_MAILBOX_NATIONAL_BASE + draft.dest.nationId;
    }

    return {
        mailbox,
        msgType: draft.msgType,
        srcId,
        destId,
        time: draft.time,
        validUntil: draft.validUntil,
        payload,
    };
};

const buildSenderOption = (draft: MessageDraft, receiverId: number): MessageOption | null => {
    const option = {
        ...(draft.option ?? {}),
        receiverMessageID: receiverId,
    };

    if (draft.msgType === 'diplomacy' && 'action' in option) {
        // Ref Message::sendToSender temporarily replaces the entire actionable
        // diplomacy option with null. Keeping year/month/deletable or the
        // receiver row id would make the sender copy actionable in a way Ref is
        // deliberately not.
        return null;
    }

    return option;
};

// 메시지 전달 규칙(수신/송신 복사본)을 그대로 유지한다.
export const sendMessage = async (
    store: MessageStore,
    draft: MessageDraft,
    options: { sendDestOnly?: boolean } = {}
): Promise<{ receiverId: number; senderId?: number }> => {
    const receiverMailbox = resolveReceiverMailbox(draft);
    if (!isValidMailbox(receiverMailbox)) {
        throw new Error(`Invalid receiver mailbox: ${receiverMailbox}`);
    }

    const receiverRecord = buildRecord(draft, receiverMailbox);
    const receiverId = await store.insertMessage(receiverRecord);
    if (!receiverId) {
        throw new Error('Failed to send receiver message.');
    }

    if (options.sendDestOnly ?? draft.sendDestOnly) {
        return { receiverId };
    }

    const senderMailbox = resolveSenderMailbox(draft);
    if (!senderMailbox || senderMailbox === receiverMailbox) {
        return { receiverId };
    }

    const senderRecord = buildRecord(draft, senderMailbox, buildSenderOption(draft, receiverId));
    const senderId = await store.insertMessage(senderRecord);

    return senderId ? { receiverId, senderId } : { receiverId };
};
