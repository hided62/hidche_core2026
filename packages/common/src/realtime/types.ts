export type MessageTypeKey = 'public' | 'private' | 'national' | 'diplomacy';

/**
 * Durable mutations summarized after the database transaction commits.
 * Entity IDs let each authenticated client decide whether its own read model
 * is affected without exposing entity payloads over the shared Redis channel.
 */
export interface RealtimeReadModelChanges {
    generalIds: number[];
    cityIds: number[];
    nationIds: number[];
    reservedGeneralIds: number[];
    recordGeneralIds: number[];
    worldChanged: boolean;
    globalRecordsChanged: boolean;
    worldHistoryChanged: boolean;
    contactsChanged: boolean;
}

export const createEmptyRealtimeReadModelChanges = (): RealtimeReadModelChanges => ({
    generalIds: [],
    cityIds: [],
    nationIds: [],
    reservedGeneralIds: [],
    recordGeneralIds: [],
    worldChanged: false,
    globalRecordsChanged: false,
    worldHistoryChanged: false,
    contactsChanged: false,
});

const mergeIds = (left: readonly number[], right: readonly number[]): number[] =>
    [...new Set([...left, ...right])].sort((a, b) => a - b);

export const mergeRealtimeReadModelChanges = (
    left: RealtimeReadModelChanges,
    right: RealtimeReadModelChanges
): RealtimeReadModelChanges => ({
    generalIds: mergeIds(left.generalIds, right.generalIds),
    cityIds: mergeIds(left.cityIds, right.cityIds),
    nationIds: mergeIds(left.nationIds, right.nationIds),
    reservedGeneralIds: mergeIds(left.reservedGeneralIds, right.reservedGeneralIds),
    recordGeneralIds: mergeIds(left.recordGeneralIds, right.recordGeneralIds),
    worldChanged: left.worldChanged || right.worldChanged,
    globalRecordsChanged: left.globalRecordsChanged || right.globalRecordsChanged,
    worldHistoryChanged: left.worldHistoryChanged || right.worldHistoryChanged,
    contactsChanged: left.contactsChanged || right.contactsChanged,
});

export const hasRealtimeReadModelChanges = (changes: RealtimeReadModelChanges): boolean =>
    changes.generalIds.length > 0 ||
    changes.cityIds.length > 0 ||
    changes.nationIds.length > 0 ||
    changes.reservedGeneralIds.length > 0 ||
    changes.recordGeneralIds.length > 0 ||
    changes.worldChanged ||
    changes.globalRecordsChanged ||
    changes.worldHistoryChanged ||
    changes.contactsChanged;

export interface TurnCompletedEvent {
    type: 'turnCompleted';
    at: string;
    lastTurnTime: string;
    /** Absent only for a rolling-deploy event produced by an older daemon. */
    changes?: RealtimeReadModelChanges;
    revision?: number;
}

export interface ReadModelChangedEvent {
    type: 'readModelChanged';
    at: string;
    changes: RealtimeReadModelChanges;
    revision: number;
}

export interface MessageCreatedEvent {
    type: 'messageCreated';
    at: string;
    mailbox: number;
    msgType: MessageTypeKey;
    messageId: number;
    senderId: number;
}

export type RealtimeEvent =
    | TurnCompletedEvent
    | ReadModelChangedEvent
    | MessageCreatedEvent;
