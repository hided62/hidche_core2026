import { describe, expect, it } from 'vitest';

import type { CanonicalTurnSnapshot } from '../src/turn-differential/canonical.js';
import {
    projectSemanticTurnMessages,
    projectSemanticUnreadMessageDeltas,
    projectStrictTurnMessageTimeline,
} from '../src/turn-differential/messageProjection.js';

const referenceMessage = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 41,
    mailbox: 2,
    type: 'private',
    sourceId: 1,
    destinationId: 2,
    createdAt: '2026-08-23 01:02:03.123456',
    validUntil: '2026-08-24 01:02:03.123456',
    payload: {
        src: { id: 1, name: '보낸이', nation_id: 1, nation: '아국', color: '#112233', icon: '/ref.png' },
        dest: { id: 2, name: '받는이', nation_id: 2, nation: '타국', color: '#445566', icon: '/ref2.png' },
        text: '아국으로 망명 권유 서신',
        option: { action: 'scout' },
    },
    ...overrides,
});

const coreMessage = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 41,
    mailbox: 2,
    type: 'private',
    sourceId: 1,
    destinationId: 2,
    createdAt: '2026-08-23T01:02:03.123Z',
    validUntil: '2026-08-24T01:02:03.123Z',
    payload: {
        src: {
            generalId: 1,
            generalName: '보낸이',
            nationId: 1,
            nationName: '아국',
            color: '#112233',
            icon: '/ref.png',
        },
        dest: {
            generalId: 2,
            generalName: '받는이',
            nationId: 2,
            nationName: '타국',
            color: '#445566',
            icon: '/ref2.png',
        },
        text: '아국으로 망명 권유 서신',
        option: { action: 'scout' },
    },
    ...overrides,
});

const snapshot = (
    generals: Array<Record<string, unknown>>,
    messages: Array<Record<string, unknown>> = [],
    gameNow = '2026-08-23 01:02:03.123456'
): CanonicalTurnSnapshot =>
    ({
        world: { gameNow },
        generals,
        messages,
    }) as unknown as CanonicalTurnSnapshot;

const general = (id: number, unreadPrivateCount: number, unreadDiplomacyCount: number): Record<string, unknown> => ({
    id,
    messageReadState: {
        unreadPrivateCount,
        unreadDiplomacyCount,
        hasUnreadMessage: unreadPrivateCount + unreadDiplomacyCount > 0,
    },
});

describe('turn message semantic projection', () => {
    it('maps Ref and Core target schemas and timestamp precision to the same message', () => {
        expect(projectSemanticTurnMessages([coreMessage()], 40)).toEqual(
            projectSemanticTurnMessages([referenceMessage()], 40)
        );
    });

    it('treats Ref empty-array and Core empty-object options as the same absence of fields', () => {
        const referencePayload = referenceMessage().payload as Record<string, unknown>;
        const corePayload = coreMessage().payload as Record<string, unknown>;

        expect(projectSemanticTurnMessages([coreMessage({ payload: { ...corePayload, option: {} } })], 40)).toEqual(
            projectSemanticTurnMessages([referenceMessage({ payload: { ...referencePayload, option: [] } })], 40)
        );
    });

    it.each([
        ['mailbox', { mailbox: 3 }],
        ['type', { type: 'diplomacy' }],
        ['source', { sourceId: 9 }],
        ['destination', { destinationId: 9 }],
        ['createdAt', { createdAt: '2026-08-23T01:02:04.123Z' }],
        ['validUntil', { validUntil: '2026-08-24T01:02:04.123Z' }],
        [
            'source icon',
            {
                payload: {
                    ...(coreMessage().payload as Record<string, unknown>),
                    src: {
                        ...((coreMessage().payload as Record<string, unknown>).src as Record<string, unknown>),
                        icon: '/mutant.png',
                    },
                },
            },
        ],
        [
            'destination icon',
            {
                payload: {
                    ...(coreMessage().payload as Record<string, unknown>),
                    dest: {
                        ...((coreMessage().payload as Record<string, unknown>).dest as Record<string, unknown>),
                        icon: '/mutant.png',
                    },
                },
            },
        ],
        [
            'text',
            {
                payload: {
                    ...(coreMessage().payload as Record<string, unknown>),
                    text: '다른 본문',
                },
            },
        ],
        [
            'option',
            {
                payload: {
                    ...(coreMessage().payload as Record<string, unknown>),
                    option: { action: 'scout', used: true },
                },
            },
        ],
    ])('keeps a %s mutation visible', (_field, overrides) => {
        expect(projectSemanticTurnMessages([coreMessage(overrides)], 40)).not.toEqual(
            projectSemanticTurnMessages([referenceMessage()], 40)
        );
    });

    it('uses explicit finite/infinite lifetimes and rejects missing or null lifetime', () => {
        expect(projectSemanticTurnMessages([referenceMessage({ validUntil: 'infinite' })], 40)[0]?.validUntil).toEqual({
            kind: 'infinite',
        });
        expect(projectSemanticTurnMessages([referenceMessage()], 40)[0]?.validUntil).toEqual({
            kind: 'finite',
            at: '2026-08-24T01:02:03.123Z',
        });
        expect(() => projectSemanticTurnMessages([referenceMessage({ validUntil: null })], 40)).toThrow(
            /message\.validUntil must be a finite timestamp or the infinite sentinel/
        );
        const missing = referenceMessage();
        delete missing.validUntil;
        expect(() => projectSemanticTurnMessages([missing], 40)).toThrow(/message\.validUntil is missing/);
    });

    it('does not normalize away a sender option difference', () => {
        const referenceSender = referenceMessage({
            mailbox: 9001,
            type: 'diplomacy',
            sourceId: 9001,
            destinationId: 9002,
            payload: {
                ...(referenceMessage().payload as Record<string, unknown>),
                option: null,
            },
        });
        const coreSender = coreMessage({
            mailbox: 9001,
            type: 'diplomacy',
            sourceId: 9001,
            destinationId: 9002,
            payload: {
                ...(coreMessage().payload as Record<string, unknown>),
                option: { receiverMessageID: 41 },
            },
        });

        expect(projectSemanticTurnMessages([coreSender], 40)).not.toEqual(
            projectSemanticTurnMessages([referenceSender], 40)
        );
        expect(projectSemanticTurnMessages([referenceSender], 40)[0]?.option).toEqual({
            kind: 'actionable-diplomacy-sender-redacted',
        });
        for (const option of [undefined, [], {}]) {
            const mutantPayload = {
                ...(referenceSender.payload as Record<string, unknown>),
                option,
            };
            expect(projectSemanticTurnMessages([{ ...referenceSender, payload: mutantPayload }], 40)).not.toEqual(
                projectSemanticTurnMessages([referenceSender], 40)
            );
        }
    });

    it('keeps absolute before, after, and message timestamps in the strict single-tick timeline', () => {
        const before = snapshot([], []);
        const frozenAfter = snapshot([], [referenceMessage()]);
        const advancedAfter = snapshot([], [referenceMessage()], '2026-08-23 01:02:03.124456');

        expect(projectStrictTurnMessageTimeline(before, frozenAfter, 40)).toEqual({
            beforeGameNow: '2026-08-23T01:02:03.123Z',
            afterGameNow: '2026-08-23T01:02:03.123Z',
            messageCreatedAts: ['2026-08-23T01:02:03.123Z'],
            usesSingleTick: true,
        });
        expect(projectStrictTurnMessageTimeline(before, advancedAfter, 40)).toEqual({
            beforeGameNow: '2026-08-23T01:02:03.123Z',
            afterGameNow: '2026-08-23T01:02:03.124Z',
            messageCreatedAts: ['2026-08-23T01:02:03.123Z'],
            usesSingleTick: false,
        });
    });

    it('projects explicit private and diplomacy unread deltas', () => {
        expect(
            projectSemanticUnreadMessageDeltas(
                snapshot([general(1, 0, 2), general(2, 0, 0)]),
                snapshot([general(1, 1, 2), general(2, 0, 1)])
            )
        ).toEqual([
            {
                generalId: 1,
                unreadPrivateBefore: 0,
                unreadPrivateAfter: 1,
                unreadPrivateDelta: 1,
                unreadDiplomacyBefore: 2,
                unreadDiplomacyAfter: 2,
                unreadDiplomacyDelta: 0,
                hadUnreadMessage: true,
                hasUnreadMessage: true,
            },
            {
                generalId: 2,
                unreadPrivateBefore: 0,
                unreadPrivateAfter: 0,
                unreadPrivateDelta: 0,
                unreadDiplomacyBefore: 0,
                unreadDiplomacyAfter: 1,
                unreadDiplomacyDelta: 1,
                hadUnreadMessage: false,
                hasUnreadMessage: true,
            },
        ]);
    });
});
