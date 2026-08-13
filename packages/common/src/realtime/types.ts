export type MessageTypeKey = 'public' | 'private' | 'national' | 'diplomacy';

/**
 * Durable mutations summarized after the database transaction commits.
 * This internal Redis contract carries entity IDs so the authenticated game
 * API can derive each subscriber's browser-safe invalidation. It must never be
 * serialized directly to a public SSE response.
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

/**
 * Browser-visible invalidation contract. It deliberately contains no entity
 * IDs, timestamps, turn times, or global revisions. The API derives these
 * viewer-specific booleans from the internal committed-change summary before
 * crossing the SSE boundary.
 */
export interface RealtimeReadModelInvalidation {
    context: boolean;
    lobby: boolean;
    map: boolean;
    commands: boolean;
    contacts: boolean;
    boardAccess: boolean;
    reservedTurns: boolean;
    records: boolean;
    frontStatus: boolean;
}

export interface RealtimeViewerIdentity {
    generalId: number | null;
    cityId: number | null;
    nationId: number | null;
}

export const createEmptyRealtimeReadModelInvalidation = (): RealtimeReadModelInvalidation => ({
    context: false,
    lobby: false,
    map: false,
    commands: false,
    contacts: false,
    boardAccess: false,
    reservedTurns: false,
    records: false,
    frontStatus: false,
});

export const createFullRealtimeReadModelInvalidation = (): RealtimeReadModelInvalidation => ({
    context: true,
    lobby: true,
    map: true,
    commands: true,
    contacts: true,
    boardAccess: true,
    reservedTurns: true,
    records: true,
    frontStatus: true,
});

export const mergeRealtimeReadModelInvalidations = (
    left: RealtimeReadModelInvalidation,
    right: RealtimeReadModelInvalidation
): RealtimeReadModelInvalidation => ({
    context: left.context || right.context,
    lobby: left.lobby || right.lobby,
    map: left.map || right.map,
    commands: left.commands || right.commands,
    contacts: left.contacts || right.contacts,
    boardAccess: left.boardAccess || right.boardAccess,
    reservedTurns: left.reservedTurns || right.reservedTurns,
    records: left.records || right.records,
    frontStatus: left.frontStatus || right.frontStatus,
});

export const hasRealtimeReadModelInvalidation = (invalidation: RealtimeReadModelInvalidation): boolean =>
    Object.values(invalidation).some(Boolean);

const contains = (ids: readonly number[], id: number | null): boolean => id !== null && ids.includes(id);

export const resolveRealtimeReadModelInvalidation = (
    changes: RealtimeReadModelChanges,
    identity: RealtimeViewerIdentity
): RealtimeReadModelInvalidation => {
    const ownGeneralChanged = contains(changes.generalIds, identity.generalId);
    const ownCityChanged = contains(changes.cityIds, identity.cityId);
    const ownNationChanged = contains(changes.nationIds, identity.nationId);
    const ownFrontStatusNationChanged = contains(
        changes.frontStatusNationIds ?? changes.nationIds,
        identity.nationId
    );
    const ownGeneralMapChanged = contains(changes.mapGeneralIds ?? changes.generalIds, identity.generalId);
    const frontStatusGeneralChanged =
        changes.frontStatusGeneralIds !== undefined
            ? changes.frontStatusGeneralIds.length > 0
            : changes.contactsChanged;
    const ownFrontStatusActorChanged = contains(changes.frontStatusActorIds ?? [], identity.generalId);
    const ownLobbyGeneralChanged = contains(changes.lobbyGeneralIds ?? changes.generalIds, identity.generalId);
    const lobbyChanged = changes.lobbyChanged ?? changes.contactsChanged;
    const entityContextChanged = ownGeneralChanged || ownCityChanged || ownNationChanged;
    const mapEntitiesChanged =
        (changes.mapCityIds ?? changes.cityIds).length > 0 ||
        (changes.mapNationIds ?? changes.nationIds).length > 0;
    const commandEntitiesChanged = changes.cityIds.length > 0 || changes.nationIds.length > 0;

    return {
        context: entityContextChanged,
        lobby: changes.worldChanged || lobbyChanged || ownLobbyGeneralChanged,
        map: changes.worldChanged || mapEntitiesChanged || ownGeneralMapChanged,
        commands: changes.worldChanged || commandEntitiesChanged || ownGeneralChanged,
        contacts: changes.contactsChanged,
        boardAccess: ownGeneralChanged || ownNationChanged,
        reservedTurns: contains(changes.reservedGeneralIds, identity.generalId),
        records:
            changes.globalRecordsChanged ||
            changes.worldHistoryChanged ||
            contains(changes.recordGeneralIds, identity.generalId),
        frontStatus:
            Boolean(changes.frontStatusChanged) ||
            frontStatusGeneralChanged ||
            ownFrontStatusNationChanged ||
            ownFrontStatusActorChanged,
    };
};

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

export interface ReadModelInvalidatedEvent {
    type: 'readModelInvalidated';
    invalidation: RealtimeReadModelInvalidation;
}

export interface MessagesInvalidatedEvent {
    type: 'messagesInvalidated';
}

/** Events safe to expose to an authenticated browser over SSE. */
export type PublicRealtimeEvent = ReadModelInvalidatedEvent | MessagesInvalidatedEvent;

export type RealtimeEvent =
    | TurnCompletedEvent
    | ReadModelChangedEvent
    | MessageCreatedEvent;
