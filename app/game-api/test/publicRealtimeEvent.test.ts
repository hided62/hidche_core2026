import { describe, expect, it } from 'vitest';

import { createEmptyRealtimeReadModelChanges, type RealtimeEvent } from '@sammo-ts/common';
import { MESSAGE_MAILBOX_NATIONAL_BASE } from '@sammo-ts/logic';

import { shouldReloadRealtimeViewerIdentity, toPublicRealtimeEvent } from '../src/realtime/publicEvent.js';

const viewer = { generalId: 7, cityId: 3, nationId: 2 } as const;

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
            },
        });
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

        expect(toPublicRealtimeEvent(event, [viewer])).toEqual({ type: 'messagesInvalidated' });
        expect(toPublicRealtimeEvent({ ...event, mailbox: MESSAGE_MAILBOX_NATIONAL_BASE + 8 }, [viewer])).toBeNull();
    });

    it('redacts durable mailbox wake-ups to one viewer-safe boolean event', () => {
        const event: RealtimeEvent = {
            type: 'messagesChanged',
            mailboxes: [7, MESSAGE_MAILBOX_NATIONAL_BASE + 8],
        };

        const publicEvent = toPublicRealtimeEvent(event, [viewer]);
        expect(publicEvent).toEqual({ type: 'messagesInvalidated' });
        expect(JSON.stringify(publicEvent)).not.toMatch(/7|9008|mailbox|revision|time/u);
        expect(
            toPublicRealtimeEvent(
                { type: 'messagesChanged', mailboxes: [MESSAGE_MAILBOX_NATIONAL_BASE + 8] },
                [viewer]
            )
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

        expect(
            toPublicRealtimeEvent(event, [viewer, { generalId: 7, cityId: 4, nationId: 3 }])
        ).toMatchObject({
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
