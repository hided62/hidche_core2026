import {
    isReadModelDomain,
    READ_MODEL_OUTBOX_PAYLOAD_VERSION,
    type ReadModelOutboxPayloadV1,
} from './changeJournal.js';
import { createEmptyRealtimeReadModelChanges, type RealtimeReadModelChanges } from './types.js';

const uniqueSortedIds = (values: Iterable<number>): number[] =>
    [...new Set(values)].sort((left, right) => left - right);

export const parseReadModelOutboxPayload = (value: unknown): ReadModelOutboxPayloadV1 | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const record = value as Record<string, unknown>;
    if (record.version !== READ_MODEL_OUTBOX_PAYLOAD_VERSION || !Array.isArray(record.changes)) {
        return null;
    }

    const changes: Array<readonly [string, number, string]> = [];
    for (const item of record.changes) {
        if (!Array.isArray(item) || item.length !== 3) {
            return null;
        }
        const [domain, entityId, revision] = item;
        if (
            typeof domain !== 'string' ||
            !isReadModelDomain(domain) ||
            !Number.isSafeInteger(entityId) ||
            (entityId as number) < 0 ||
            typeof revision !== 'string' ||
            !/^(?:0|[1-9][0-9]*)$/u.test(revision)
        ) {
            return null;
        }
        try {
            BigInt(revision);
        } catch {
            return null;
        }
        changes.push([domain, entityId as number, revision]);
    }
    return { version: READ_MODEL_OUTBOX_PAYLOAD_VERSION, changes } as ReadModelOutboxPayloadV1;
};

/**
 * Converts the durable internal domain envelope back into the legacy internal
 * invalidation shape. The result still contains entity IDs and must be
 * viewer-filtered before it crosses the public SSE boundary.
 */
export const readModelOutboxPayloadToChanges = (
    payload: ReadModelOutboxPayloadV1
): RealtimeReadModelChanges => {
    const changes = createEmptyRealtimeReadModelChanges();
    const generalIds: number[] = [];
    const cityIds: number[] = [];
    const nationIds: number[] = [];
    const mapGeneralIds: number[] = [];
    const frontStatusNationIds: number[] = [];
    const frontStatusActorIds: number[] = [];
    const lobbyGeneralIds: number[] = [];
    const reservedGeneralIds: number[] = [];
    const recordGeneralIds: number[] = [];

    for (const [domain, entityId] of payload.changes) {
        switch (domain) {
            case 'general.content':
                generalIds.push(entityId);
                break;
            case 'city.content':
                cityIds.push(entityId);
                break;
            case 'nation.content':
                nationIds.push(entityId);
                break;
            case 'world.content':
                changes.worldChanged = true;
                break;
            case 'map.world':
                changes.mapChanged = true;
                break;
            case 'map.general':
                mapGeneralIds.push(entityId);
                break;
            case 'records.general':
                recordGeneralIds.push(entityId);
                break;
            case 'records.global':
                changes.globalRecordsChanged = true;
                break;
            case 'records.history':
                changes.worldHistoryChanged = true;
                break;
            case 'front.general':
                frontStatusActorIds.push(entityId);
                break;
            case 'front.nation':
                frontStatusNationIds.push(entityId);
                break;
            case 'front.global':
                changes.frontStatusChanged = true;
                break;
            case 'lobby.world':
                changes.lobbyChanged = true;
                break;
            case 'lobby.general':
                lobbyGeneralIds.push(entityId);
                break;
            case 'contacts.world':
                changes.contactsChanged = true;
                break;
            case 'reserved.general':
                reservedGeneralIds.push(entityId);
                break;
            case 'access.general':
            case 'tournament':
            case 'betting':
                // These domains have no browser-wide dashboard invalidation.
                break;
        }
    }

    return {
        ...changes,
        generalIds: uniqueSortedIds(generalIds),
        cityIds: uniqueSortedIds(cityIds),
        nationIds: uniqueSortedIds(nationIds),
        mapGeneralIds: uniqueSortedIds(mapGeneralIds),
        frontStatusNationIds: uniqueSortedIds(frontStatusNationIds),
        frontStatusActorIds: uniqueSortedIds(frontStatusActorIds),
        lobbyGeneralIds: uniqueSortedIds(lobbyGeneralIds),
        reservedGeneralIds: uniqueSortedIds(reservedGeneralIds),
        recordGeneralIds: uniqueSortedIds(recordGeneralIds),
    };
};
