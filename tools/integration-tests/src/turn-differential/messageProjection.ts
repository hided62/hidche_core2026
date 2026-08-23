import type { CanonicalTurnSnapshot } from './canonical.js';

type JsonRecord = Record<string, unknown>;

export interface SemanticTurnMessageTarget {
    generalId: number;
    generalName: string;
    nationId: number;
    nationName: string;
    color: string;
    icon: string;
}

export type SemanticTurnMessageLifetime = { kind: 'finite'; at: string } | { kind: 'infinite' };

export interface SemanticTurnMessage {
    mailbox: number;
    type: string;
    sourceId: number;
    destinationId: number;
    createdAt: string;
    validUntil: SemanticTurnMessageLifetime;
    source: SemanticTurnMessageTarget;
    destination: SemanticTurnMessageTarget;
    text: string;
    option: unknown;
}

export interface StrictTurnMessageTimeline {
    beforeGameNow: string;
    afterGameNow: string;
    messageCreatedAts: string[];
    usesSingleTick: boolean;
}

export interface SemanticUnreadMessageDelta {
    generalId: number;
    unreadPrivateBefore: number;
    unreadPrivateAfter: number;
    unreadPrivateDelta: number;
    unreadDiplomacyBefore: number;
    unreadDiplomacyAfter: number;
    unreadDiplomacyDelta: number;
    hadUnreadMessage: boolean;
    hasUnreadMessage: boolean;
}

const asRecord = (value: unknown, field: string): JsonRecord => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${field} must be an object`);
    }
    return value as JsonRecord;
};

const readAliasedValue = (record: JsonRecord, aliases: readonly string[], field: string): unknown => {
    for (const alias of aliases) {
        if (Object.prototype.hasOwnProperty.call(record, alias)) {
            return record[alias];
        }
    }
    throw new Error(`${field} is missing`);
};

const readNumber = (record: JsonRecord, aliases: readonly string[], field: string): number => {
    const value = readAliasedValue(record, aliases, field);
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(number)) {
        throw new Error(`${field} must be a finite number`);
    }
    return number;
};

const readString = (record: JsonRecord, aliases: readonly string[], field: string): string => {
    const value = readAliasedValue(record, aliases, field);
    if (typeof value !== 'string') {
        throw new Error(`${field} must be a string`);
    }
    return value;
};

const normalizeTimestamp = (value: unknown, field = 'createdAt'): string => {
    const raw = value instanceof Date ? value.toISOString() : String(value);
    const withTimezone = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`;
    const millisecondPrecision = withTimezone.replace(/(\.\d{3})\d+(?=(?:Z|[+-]\d{2}:\d{2})$)/u, '$1');
    const timestamp = Date.parse(millisecondPrecision);
    if (!Number.isFinite(timestamp)) {
        throw new Error(`${field} must be a valid timestamp: ${raw}`);
    }
    return new Date(timestamp).toISOString();
};

const normalizeMessageLifetime = (value: unknown): SemanticTurnMessageLifetime => {
    if (value === 'infinite') {
        return { kind: 'infinite' };
    }
    if (value === null || value === undefined) {
        throw new Error('message.validUntil must be a finite timestamp or the infinite sentinel');
    }
    return { kind: 'finite', at: normalizeTimestamp(value, 'message.validUntil') };
};

const normalizeJsonValue = (value: unknown): unknown => {
    if (Array.isArray(value)) {
        return value.map(normalizeJsonValue);
    }
    if (typeof value !== 'object' || value === null) {
        return value;
    }
    const record = value as JsonRecord;
    return Object.fromEntries(
        Object.keys(record)
            .sort()
            .map((key) => [key, normalizeJsonValue(record[key])])
    );
};

const normalizeOption = (value: unknown, context: { mailbox: number; type: string; sourceId: number }): unknown => {
    if (context.type === 'diplomacy' && context.mailbox === context.sourceId && value === null) {
        return { kind: 'actionable-diplomacy-sender-redacted' };
    }
    // Ref serializes an empty PHP option array as `[]`, while Core represents
    // the same absence of option fields as `{}`. Non-empty arrays and every
    // option field remain exact. The actionable diplomacy sender null above is
    // a distinct security contract and must not collapse into ordinary absence.
    if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
        return {};
    }
    return normalizeJsonValue(value);
};

const normalizeTarget = (value: unknown, field: string): SemanticTurnMessageTarget => {
    const target = asRecord(value, field);
    return {
        generalId: readNumber(target, ['generalId', 'id'], `${field}.generalId`),
        generalName: readString(target, ['generalName', 'name'], `${field}.generalName`),
        nationId: readNumber(target, ['nationId', 'nation_id'], `${field}.nationId`),
        nationName: readString(target, ['nationName', 'nation'], `${field}.nationName`),
        color: readString(target, ['color'], `${field}.color`),
        icon: readString(target, ['icon'], `${field}.icon`),
    };
};

export const projectSemanticTurnMessages = (
    messages: CanonicalTurnSnapshot['messages'],
    messageAfterId: number
): SemanticTurnMessage[] =>
    messages
        .filter((message) => readNumber(message, ['id'], 'message.id') > messageAfterId)
        .map((message) => {
            const payload = asRecord(readAliasedValue(message, ['payload'], 'message.payload'), 'message.payload');
            const mailbox = readNumber(message, ['mailbox'], 'message.mailbox');
            const type = readString(message, ['type'], 'message.type');
            const sourceId = readNumber(message, ['sourceId'], 'message.sourceId');
            return {
                mailbox,
                type,
                sourceId,
                destinationId: readNumber(message, ['destinationId'], 'message.destinationId'),
                createdAt: normalizeTimestamp(readAliasedValue(message, ['createdAt'], 'message.createdAt')),
                validUntil: normalizeMessageLifetime(readAliasedValue(message, ['validUntil'], 'message.validUntil')),
                source: normalizeTarget(
                    readAliasedValue(payload, ['src'], 'message.payload.src'),
                    'message.payload.src'
                ),
                destination: normalizeTarget(
                    readAliasedValue(payload, ['dest'], 'message.payload.dest'),
                    'message.payload.dest'
                ),
                text: readString(payload, ['text'], 'message.payload.text'),
                option: normalizeOption(payload.option, { mailbox, type, sourceId }),
            };
        });

export const projectStrictTurnMessageTimeline = (
    before: CanonicalTurnSnapshot,
    after: CanonicalTurnSnapshot,
    messageAfterId: number
): StrictTurnMessageTimeline => {
    const beforeGameNow = normalizeTimestamp(
        readAliasedValue(asRecord(before.world, 'before.world'), ['gameNow'], 'before.world.gameNow')
    );
    const afterGameNow = normalizeTimestamp(
        readAliasedValue(asRecord(after.world, 'after.world'), ['gameNow'], 'after.world.gameNow')
    );
    const messageCreatedAts = projectSemanticTurnMessages(after.messages, messageAfterId).map(
        (message) => message.createdAt
    );
    return {
        beforeGameNow,
        afterGameNow,
        messageCreatedAts,
        usesSingleTick:
            afterGameNow === beforeGameNow && messageCreatedAts.every((createdAt) => createdAt === beforeGameNow),
    };
};

interface SemanticUnreadState {
    unreadPrivateCount: number;
    unreadDiplomacyCount: number;
    hasUnreadMessage: boolean;
}

const readUnreadState = (general: JsonRecord): SemanticUnreadState => {
    const generalId = readNumber(general, ['id'], 'general.id');
    const state = asRecord(general.messageReadState, `general[${generalId}].messageReadState`);
    const hasUnreadMessage = readAliasedValue(
        state,
        ['hasUnreadMessage'],
        `general[${generalId}].messageReadState.hasUnreadMessage`
    );
    if (typeof hasUnreadMessage !== 'boolean') {
        throw new Error(`general[${generalId}].messageReadState.hasUnreadMessage must be a boolean`);
    }
    return {
        unreadPrivateCount: readNumber(
            state,
            ['unreadPrivateCount'],
            `general[${generalId}].messageReadState.unreadPrivateCount`
        ),
        unreadDiplomacyCount: readNumber(
            state,
            ['unreadDiplomacyCount'],
            `general[${generalId}].messageReadState.unreadDiplomacyCount`
        ),
        hasUnreadMessage,
    };
};

export const projectSemanticUnreadMessageDeltas = (
    before: CanonicalTurnSnapshot,
    after: CanonicalTurnSnapshot
): SemanticUnreadMessageDelta[] => {
    const beforeByGeneralId = new Map(
        before.generals.map((general) => [readNumber(general, ['id'], 'general.id'), readUnreadState(general)] as const)
    );
    const afterByGeneralId = new Map(
        after.generals.map((general) => [readNumber(general, ['id'], 'general.id'), readUnreadState(general)] as const)
    );
    const generalIds = [...new Set([...beforeByGeneralId.keys(), ...afterByGeneralId.keys()])].sort(
        (left, right) => left - right
    );

    return generalIds.map((generalId) => {
        const beforeState = beforeByGeneralId.get(generalId) ?? {
            unreadPrivateCount: 0,
            unreadDiplomacyCount: 0,
            hasUnreadMessage: false,
        };
        const afterState = afterByGeneralId.get(generalId) ?? {
            unreadPrivateCount: 0,
            unreadDiplomacyCount: 0,
            hasUnreadMessage: false,
        };
        return {
            generalId,
            unreadPrivateBefore: beforeState.unreadPrivateCount,
            unreadPrivateAfter: afterState.unreadPrivateCount,
            unreadPrivateDelta: afterState.unreadPrivateCount - beforeState.unreadPrivateCount,
            unreadDiplomacyBefore: beforeState.unreadDiplomacyCount,
            unreadDiplomacyAfter: afterState.unreadDiplomacyCount,
            unreadDiplomacyDelta: afterState.unreadDiplomacyCount - beforeState.unreadDiplomacyCount,
            hadUnreadMessage: beforeState.hasUnreadMessage,
            hasUnreadMessage: afterState.hasUnreadMessage,
        };
    });
};
