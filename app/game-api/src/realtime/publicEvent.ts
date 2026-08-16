import {
    createFullRealtimeReadModelInvalidation,
    hasRealtimeReadModelInvalidation,
    mergeRealtimeReadModelInvalidations,
    resolveRealtimeReadModelInvalidation,
    type PublicRealtimeEvent,
    type RealtimeEvent,
    type RealtimeReadModelChanges,
    type RealtimeViewerIdentity,
} from '@sammo-ts/common';
import { MESSAGE_MAILBOX_NATIONAL_BASE, MESSAGE_MAILBOX_PUBLIC } from '@sammo-ts/logic';

const uniqueIdentities = (identities: readonly RealtimeViewerIdentity[]): RealtimeViewerIdentity[] => {
    const seen = new Set<string>();
    return identities.filter((identity) => {
        const key = `${identity.generalId ?? ''}:${identity.cityId ?? ''}:${identity.nationId ?? ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

const isMailboxRelevant = (mailbox: number, identity: RealtimeViewerIdentity): boolean =>
    mailbox === MESSAGE_MAILBOX_PUBLIC ||
    (identity.generalId !== null && mailbox === identity.generalId) ||
    (identity.nationId !== null && mailbox === MESSAGE_MAILBOX_NATIONAL_BASE + identity.nationId);

const eventChanges = (event: RealtimeEvent): RealtimeReadModelChanges | null => {
    if (event.type === 'readModelChanged') return event.changes;
    if (event.type === 'turnCompleted') return event.changes ?? null;
    return null;
};

export const shouldReloadRealtimeViewerIdentity = (
    event: RealtimeEvent,
    identity: RealtimeViewerIdentity
): boolean => {
    if (identity.generalId === null) return false;
    const changes = eventChanges(event);
    if (!changes) return false;
    const generalId = identity.generalId;
    return [
        changes.generalIds,
        changes.mapGeneralIds ?? changes.generalIds,
        changes.frontStatusGeneralIds ?? [],
        changes.frontStatusActorIds ?? [],
        changes.lobbyGeneralIds ?? changes.generalIds,
        changes.reservedGeneralIds,
        changes.recordGeneralIds,
    ].some((ids) => ids.includes(generalId));
};

/**
 * Converts an internal Redis event to the minimal browser contract. Empty
 * clock-only turn events are suppressed; the remaining payload never includes
 * entity IDs, wall-clock timestamps, logical turn times, or revisions.
 */
export const toPublicRealtimeEvent = (
    event: RealtimeEvent,
    identities: readonly RealtimeViewerIdentity[]
): PublicRealtimeEvent | null => {
    const viewers = uniqueIdentities(
        identities.length > 0 ? identities : [{ generalId: null, cityId: null, nationId: null }]
    );
    if (event.type === 'messageCreated' || event.type === 'messagesChanged') {
        const mailboxes = event.type === 'messageCreated' ? [event.mailbox] : event.mailboxes;
        return viewers.some((identity) => mailboxes.some((mailbox) => isMailboxRelevant(mailbox, identity)))
            ? { type: 'messagesInvalidated' }
            : null;
    }

    if (event.type === 'turnCompleted' && !event.changes) {
        return {
            type: 'readModelInvalidated',
            invalidation: createFullRealtimeReadModelInvalidation(),
        };
    }

    const changes = eventChanges(event);
    if (!changes) return null;
    const invalidation = viewers
        .map((identity) => resolveRealtimeReadModelInvalidation(changes, identity))
        .reduce(mergeRealtimeReadModelInvalidations);
    if (!hasRealtimeReadModelInvalidation(invalidation)) return null;
    return { type: 'readModelInvalidated', invalidation };
};
