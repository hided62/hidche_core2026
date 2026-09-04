import { describe, expect, it } from 'vitest';

import { createEmptyRealtimeReadModelChanges, type RealtimeEvent } from '@sammo-ts/common';
import { MESSAGE_MAILBOX_NATIONAL_BASE } from '@sammo-ts/logic';

import {
    shouldForwardRealtimeEvent,
    shouldReloadRealtimeViewerIdentity,
    toPublicRealtimeEvent as convertPublicRealtimeEvent,
} from '../src/realtime/publicEvent.js';

const viewer = { generalId: 7, cityId: 3, nationId: 2, canReadDiplomacy: true } as const;
const refreshGrant = 'opaque-grant';
const toPublicRealtimeEvent = (event: RealtimeEvent, identities: Parameters<typeof convertPublicRealtimeEvent>[1]) =>
    convertPublicRealtimeEvent(event, identities, () => refreshGrant);

const turnEvent = (changes = createEmptyRealtimeReadModelChanges()): RealtimeEvent => ({
    type: 'turnCompleted',
    at: '2026-08-12T12:34:56.789Z',
    lastTurnTime: '0185-02-01T00:00:00.000Z',
    changes,
    revision: 42,
});

describe('public realtime event privacy boundary', () => {
    it('suppresses clock-only and unrelated private general turns', () => {
        expect(toPublicRealtimeEvent(turnEvent(), [viewer])).toBeNull();
        expect(
            toPublicRealtimeEvent(
                turnEvent({
                    ...createEmptyRealtimeReadModelChanges(),
                    generalIds: [99],
                }),
                [viewer]
            )
        ).toBeNull();
    });

    it('publishes only viewer-specific boolean invalidations', () => {
        const publicEvent = toPublicRealtimeEvent(
            turnEvent({
                ...createEmptyRealtimeReadModelChanges(),
                generalIds: [7, 99],
                reservedGeneralIds: [7],
                recordGeneralIds: [7],
            }),
            [viewer]
        );

        expect(publicEvent).toEqual({
            type: 'readModelInvalidated',
            refreshGrant,
            invalidation: {
                context: true,
                lobby: false,
                map: false,
                commands: true,
                contacts: false,
                boardAccess: true,
                reservedTurns: true,
                records: true,
                frontStatus: false,
                tournament: false,
            },
        });
        const serialized = JSON.stringify(publicEvent);
        expect(publicEvent).not.toHaveProperty('at');
        expect(publicEvent).not.toHaveProperty('lastTurnTime');
        expect(publicEvent).not.toHaveProperty('revision');
        for (const forbidden of ['generalIds', 'cityIds', 'nationIds', '99']) {
            expect(serialized).not.toContain(forbidden);
        }
    });

    it('keeps global refresh meaning without exposing its source identity or time', () => {
        const publicEvent = toPublicRealtimeEvent(
            {
                type: 'readModelChanged',
                at: '2026-08-12T12:34:56.789Z',
                revision: 43,
                changes: {
                    ...createEmptyRealtimeReadModelChanges(),
                    worldChanged: true,
                    globalRecordsChanged: true,
                    worldHistoryChanged: true,
                },
            },
            [viewer]
        );

        expect(publicEvent).toMatchObject({
            type: 'readModelInvalidated',
            invalidation: { lobby: true, map: true, commands: true, records: true },
        });
        expect(JSON.stringify(publicEvent)).not.toMatch(/2026|0185|revision|Ids/u);
    });

    it('uses a conservative identifier-free fallback for an older daemon', () => {
        expect(
            toPublicRealtimeEvent(
                {
                    type: 'turnCompleted',
                    at: '2026-08-12T12:34:56.789Z',
                    lastTurnTime: '0185-02-01T00:00:00.000Z',
                },
                [viewer]
            )
        ).toEqual({
            type: 'readModelInvalidated',
            refreshGrant,
            invalidation: {
                context: true,
                lobby: true,
                map: true,
                commands: true,
                contacts: true,
                boardAccess: true,
                reservedTurns: true,
                records: true,
                frontStatus: true,
                tournament: true,
            },
        });
    });

    it('redacts tournament state changes to one global boolean invalidation', () => {
        const publicEvent = toPublicRealtimeEvent({ type: 'tournamentChanged' }, [viewer]);

        expect(publicEvent).toEqual({
            type: 'readModelInvalidated',
            refreshGrant,
            invalidation: {
                context: false,
                lobby: false,
                map: false,
                commands: false,
                contacts: false,
                boardAccess: false,
                reservedTurns: false,
                records: false,
                frontStatus: false,
                tournament: true,
            },
        });
        expect(JSON.stringify(publicEvent)).not.toMatch(/revision|source|channel|time|generalId/u);
        expect(shouldReloadRealtimeViewerIdentity({ type: 'tournamentChanged' }, viewer)).toBe(false);
    });

    it('exposes tournament page refresh selection without projection identity or revision', () => {
        const invalidation = { snapshot: true, betting: false, rankings: false, generalId: 7 };
        const publicEvent = toPublicRealtimeEvent(
            {
                type: 'tournamentProjectionChanged',
                invalidation,
            },
            [viewer]
        );

        expect(publicEvent).toEqual({
            type: 'tournamentViewInvalidated',
            refreshGrant,
            invalidation: { snapshot: true, betting: false, rankings: false },
        });
        expect(JSON.stringify(publicEvent)).not.toMatch(/revision|source|channel|time|generalId|matchId/u);
        expect(
            shouldReloadRealtimeViewerIdentity(
                {
                    type: 'tournamentProjectionChanged',
                    invalidation: { snapshot: false, betting: true, rankings: false },
                },
                viewer
            )
        ).toBe(false);
    });

    it('routes tournament projection traffic only to the dedicated page-family subscription', () => {
        const projectionEvent: RealtimeEvent = {
            type: 'tournamentProjectionChanged',
            invalidation: { snapshot: true, betting: false, rankings: false },
        };
        expect(shouldForwardRealtimeEvent(projectionEvent, 'dashboard')).toBe(false);
        expect(shouldForwardRealtimeEvent(projectionEvent, 'tournament')).toBe(true);
        expect(shouldForwardRealtimeEvent({ type: 'tournamentChanged' }, 'dashboard')).toBe(true);
        expect(shouldForwardRealtimeEvent({ type: 'tournamentChanged' }, 'tournament')).toBe(false);
    });

    it('filters message events per viewer and removes mailbox, sender, message, and time fields', () => {
        const event: RealtimeEvent = {
            type: 'messageCreated',
            at: '2026-08-12T12:34:56.789Z',
            mailbox: MESSAGE_MAILBOX_NATIONAL_BASE + viewer.nationId,
            msgType: 'national',
            messageId: 123,
            senderId: 99,
        };

        expect(toPublicRealtimeEvent(event, [viewer])).toEqual({ type: 'messagesInvalidated', refreshGrant });
        expect(toPublicRealtimeEvent({ ...event, mailbox: MESSAGE_MAILBOX_NATIONAL_BASE + 8 }, [viewer])).toBeNull();
    });

    it('suppresses diplomacy-only wake-ups for viewers without secret-message access', () => {
        const mailbox = MESSAGE_MAILBOX_NATIONAL_BASE + viewer.nationId;
        const blockedViewer = { ...viewer, canReadDiplomacy: false };
        expect(
            toPublicRealtimeEvent(
                {
                    type: 'messageCreated',
                    at: '2026-09-04T00:00:00Z',
                    mailbox,
                    msgType: 'diplomacy',
                    messageId: 1,
                    senderId: 2,
                },
                [blockedViewer]
            )
        ).toBeNull();
        expect(
            toPublicRealtimeEvent({ type: 'messagesChanged', mailboxes: [], diplomacyMailboxes: [mailbox] }, [
                blockedViewer,
            ])
        ).toBeNull();
        expect(
            toPublicRealtimeEvent({ type: 'messagesChanged', mailboxes: [mailbox], diplomacyMailboxes: [mailbox] }, [
                blockedViewer,
            ])
        ).toEqual({ type: 'messagesInvalidated', refreshGrant });
        expect(
            toPublicRealtimeEvent({ type: 'messagesChanged', mailboxes: [], diplomacyMailboxes: [mailbox] }, [viewer])
        ).toEqual({ type: 'messagesInvalidated', refreshGrant });
    });

    it('redacts durable mailbox wake-ups to one viewer-safe boolean event', () => {
        const event: RealtimeEvent = {
            type: 'messagesChanged',
            mailboxes: [7, MESSAGE_MAILBOX_NATIONAL_BASE + 8],
        };

        const publicEvent = toPublicRealtimeEvent(event, [viewer]);
        expect(publicEvent).toEqual({ type: 'messagesInvalidated', refreshGrant });
        expect(JSON.stringify(publicEvent)).not.toMatch(/7|9008|mailbox|revision|time/u);
        expect(
            toPublicRealtimeEvent({ type: 'messagesChanged', mailboxes: [MESSAGE_MAILBOX_NATIONAL_BASE + 8] }, [viewer])
        ).toBeNull();
    });

    it('requests an identity refresh only when the viewer general may have changed', () => {
        expect(
            shouldReloadRealtimeViewerIdentity(
                turnEvent({ ...createEmptyRealtimeReadModelChanges(), generalIds: [7] }),
                viewer
            )
        ).toBe(true);
        expect(
            shouldReloadRealtimeViewerIdentity(
                turnEvent({ ...createEmptyRealtimeReadModelChanges(), generalIds: [99] }),
                viewer
            )
        ).toBe(false);
        expect(
            shouldReloadRealtimeViewerIdentity(
                turnEvent({ ...createEmptyRealtimeReadModelChanges(), nationIds: [viewer.nationId] }),
                viewer
            )
        ).toBe(true);
    });

    it('merges previous and committed identities across an ownership transition', () => {
        const event: RealtimeEvent = {
            type: 'readModelChanged',
            at: '2026-08-12T12:34:56.789Z',
            revision: 44,
            changes: {
                ...createEmptyRealtimeReadModelChanges(),
                generalIds: [7],
                nationIds: [3],
                frontStatusNationIds: [3],
            },
        };

        expect(toPublicRealtimeEvent(event, [viewer, { generalId: 7, cityId: 4, nationId: 3 }])).toMatchObject({
            type: 'readModelInvalidated',
            invalidation: {
                context: true,
                commands: true,
                boardAccess: true,
                frontStatus: true,
            },
        });
    });
});
