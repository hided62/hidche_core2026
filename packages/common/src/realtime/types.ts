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
    /** Entity IDs whose map projection changed. Absent on older daemons. */
    mapGeneralIds?: number[];
    mapCityIds?: number[];
    mapNationIds?: number[];
    /** Generals whose name/nation projection used by front status changed. */
    frontStatusGeneralIds?: number[];
    /** Nations whose viewer-specific notice projection changed. */
    frontStatusNationIds?: number[];
    /** Generals whose viewer-specific front-status projection changed. */
    frontStatusActorIds?: number[];
    /** Generals whose name/icon projection shown in their own lobby changed. */
    lobbyGeneralIds?: number[];
    reservedGeneralIds: number[];
    recordGeneralIds: number[];
    worldChanged: boolean;
    globalRecordsChanged: boolean;
    worldHistoryChanged: boolean;
    contactsChanged: boolean;
    /** A global front-status source such as the active survey changed. */
    frontStatusChanged?: boolean;
    lobbyChanged?: boolean;
}

export const createEmptyRealtimeReadModelChanges = (): RealtimeReadModelChanges => ({
    generalIds: [],
    cityIds: [],
    nationIds: [],
    mapGeneralIds: [],
    mapCityIds: [],
    mapNationIds: [],
    frontStatusGeneralIds: [],
    frontStatusNationIds: [],
    frontStatusActorIds: [],
    lobbyGeneralIds: [],
    reservedGeneralIds: [],
    recordGeneralIds: [],
    worldChanged: false,
    globalRecordsChanged: false,
    worldHistoryChanged: false,
    contactsChanged: false,
    frontStatusChanged: false,
    lobbyChanged: false,
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
    mapGeneralIds: mergeIds(left.mapGeneralIds ?? left.generalIds, right.mapGeneralIds ?? right.generalIds),
    mapCityIds: mergeIds(left.mapCityIds ?? left.cityIds, right.mapCityIds ?? right.cityIds),
    mapNationIds: mergeIds(left.mapNationIds ?? left.nationIds, right.mapNationIds ?? right.nationIds),
    frontStatusGeneralIds: mergeIds(
        left.frontStatusGeneralIds ?? (left.contactsChanged ? left.generalIds : []),
        right.frontStatusGeneralIds ?? (right.contactsChanged ? right.generalIds : [])
    ),
    frontStatusNationIds: mergeIds(
        left.frontStatusNationIds ?? left.nationIds,
        right.frontStatusNationIds ?? right.nationIds
    ),
    frontStatusActorIds: mergeIds(left.frontStatusActorIds ?? [], right.frontStatusActorIds ?? []),
    lobbyGeneralIds: mergeIds(left.lobbyGeneralIds ?? left.generalIds, right.lobbyGeneralIds ?? right.generalIds),
    reservedGeneralIds: mergeIds(left.reservedGeneralIds, right.reservedGeneralIds),
    recordGeneralIds: mergeIds(left.recordGeneralIds, right.recordGeneralIds),
    worldChanged: left.worldChanged || right.worldChanged,
    globalRecordsChanged: left.globalRecordsChanged || right.globalRecordsChanged,
    worldHistoryChanged: left.worldHistoryChanged || right.worldHistoryChanged,
    contactsChanged: left.contactsChanged || right.contactsChanged,
    frontStatusChanged: Boolean(left.frontStatusChanged) || Boolean(right.frontStatusChanged),
    lobbyChanged: (left.lobbyChanged ?? left.contactsChanged) || (right.lobbyChanged ?? right.contactsChanged),
});

export const hasRealtimeReadModelChanges = (changes: RealtimeReadModelChanges): boolean =>
    changes.generalIds.length > 0 ||
    changes.cityIds.length > 0 ||
    changes.nationIds.length > 0 ||
    (changes.frontStatusActorIds?.length ?? 0) > 0 ||
    changes.reservedGeneralIds.length > 0 ||
    changes.recordGeneralIds.length > 0 ||
    changes.worldChanged ||
    changes.globalRecordsChanged ||
    changes.worldHistoryChanged ||
    changes.contactsChanged ||
    Boolean(changes.frontStatusChanged) ||
    Boolean(changes.lobbyChanged);

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
