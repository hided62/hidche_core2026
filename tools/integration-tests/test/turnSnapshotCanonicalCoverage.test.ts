import { GameClock, MAX_SAFE_GAME_TICK } from '@sammo-ts/common';
import { describe, expect, it } from 'vitest';

import {
    closeTurnSnapshotSelectorOverCreatedEntities,
    projectCoreDatabaseSnapshot,
    type CanonicalTurnSnapshot,
} from '../src/turn-differential/canonical.js';
import { compareTurnSnapshotDeltas, compareTurnSnapshots } from '../src/turn-differential/compare.js';
import { projectCoreMessageDrafts, projectCoreMessageReadState } from '../src/turn-differential/coreCommandTrace.js';
import { projectEffectiveCoreMessageValidUntil } from '../src/turn-differential/databaseSnapshot.js';
import { projectFullLifecycleSnapshotGraph } from '../src/turn-differential/fullLifecycleFixture.js';

interface CommandStateFixture {
    generalMeta: Record<string, unknown>;
    generalFields?: Record<string, unknown>;
    nationMeta: Record<string, unknown>;
    nationFields?: Record<string, unknown>;
}

const databaseSnapshot = (
    latestReadPrivateMessage = 0,
    commandStateFixture?: CommandStateFixture
): CanonicalTurnSnapshot =>
    projectCoreDatabaseSnapshot({
        world: {
            currentYear: 183,
            currentMonth: 1,
            tickSeconds: 600,
            meta: { lastTurnTime: '0183-01-01T00:00:00.000Z', isUnited: 0 },
            gameNow: new Date('0183-01-01T00:10:00.000Z'),
            lastTurnTick: 0,
        },
        generals: [
            {
                id: 1,
                name: '조조',
                nationId: 1,
                cityId: 1,
                troopId: 1,
                userId: 'owner-a',
                meta: commandStateFixture?.generalMeta ?? {},
                penalty: {},
                ...commandStateFixture?.generalFields,
            },
        ],
        rankData: [],
        cities: [],
        nations: commandStateFixture
            ? [
                  {
                      id: 1,
                      name: '위',
                      color: '#111111',
                      capitalCityId: 1,
                      gold: 1_000,
                      rice: 1_000,
                      tech: 100,
                      level: 1,
                      typeCode: 'che_명가',
                      meta: commandStateFixture.nationMeta,
                      ...commandStateFixture.nationFields,
                  },
              ]
            : [],
        troops: [{ troopLeaderId: 1, nationId: 1, name: '조조군' }],
        diplomacy: [],
        generalTurns: [],
        nationTurns: [],
        logs: [],
        messages: [
            {
                id: 71,
                mailbox: 1,
                type: 'private',
                src: 2,
                dest: 1,
                time: new Date('0183-01-01T00:10:00.000Z'),
                validUntil: new Date('0183-04-01T00:10:00.000Z'),
                message: { text: '등용 서신' },
            },
        ],
        messageReadStates: [
            {
                generalId: 1,
                latestPrivateMessage: latestReadPrivateMessage,
                latestDiplomacyMessage: 0,
            },
        ],
        messageInboxRows: [{ id: 71, mailbox: 1, type: 'private', src: 2 }],
        messageWatermark: 71,
    });

describe('turn snapshot canonical blind-spot coverage', () => {
    it('projects troop rows and detects a troop mutant', () => {
        const reference = databaseSnapshot();
        const core = {
            ...databaseSnapshot(),
            troops: [{ id: 1, nationId: 1, name: '변조된 부대' }],
        };

        expect(reference.troops).toEqual([{ id: 1, nationId: 1, name: '조조군' }]);
        expect(reference.world.gameNow).toBe('0183-01-01T00:10:00.000Z');
        expect(compareTurnSnapshots(reference, core)).toContainEqual({
            path: 'troops[1].name',
            reference: '조조군',
            core: '변조된 부대',
        });
    });

    it('projects persisted message rows and detects a message mutant', () => {
        const reference = databaseSnapshot();
        const core = {
            ...databaseSnapshot(),
            messages: [{ ...databaseSnapshot().messages[0], sourceId: 9 }],
        };

        expect(reference.messages).toEqual([
            {
                id: 71,
                mailbox: 1,
                type: 'private',
                sourceId: 2,
                destinationId: 1,
                createdAt: '0183-01-01T00:10:00.000Z',
                validUntil: '0183-04-01T00:10:00.000Z',
                payload: { text: '등용 서신' },
            },
        ]);
        expect(reference.watermarks.messageId).toBe(71);
        expect(compareTurnSnapshots(reference, core)).toContainEqual({
            path: 'messages[0].sourceId',
            reference: 2,
            core: 9,
        });
    });

    it('expands a Core message draft into the persisted receiver and sender rows', async () => {
        const messages = await projectCoreMessageDrafts(
            [
                {
                    msgType: 'private',
                    src: {
                        generalId: 1,
                        generalName: '조조',
                        nationId: 1,
                        nationName: '위',
                        color: '#111111',
                        icon: '1.webp',
                    },
                    dest: {
                        generalId: 2,
                        generalName: '유비',
                        nationId: 2,
                        nationName: '촉',
                        color: '#222222',
                        icon: '2.webp',
                    },
                    text: '등용 서신',
                    time: new Date('0183-01-01T00:10:00.000Z'),
                    validUntil: new Date('0183-04-01T00:10:00.000Z'),
                },
            ],
            70
        );

        expect(messages).toHaveLength(2);
        expect(messages[0]).toMatchObject({
            id: 71,
            mailbox: 2,
            type: 'private',
            sourceId: 1,
            destinationId: 2,
            validUntil: '0183-04-01T00:10:00.000Z',
            payload: { text: '등용 서신' },
        });
        expect(messages[1]).toMatchObject({
            id: 72,
            mailbox: 1,
            validUntil: '0183-04-01T00:10:00.000Z',
            payload: { option: { receiverMessageID: 71 } },
        });
        expect(projectCoreMessageReadState(2, 2, messages)).toEqual({
            unreadPrivateCount: 1,
            unreadDiplomacyCount: 0,
            hasUnreadMessage: true,
        });
    });

    it('uses a persisted validity tick ahead of the Date fallback and keeps infinity explicit', () => {
        const clock = new GameClock({
            baseTime: new Date('0183-01-01T00:00:00.000Z'),
            tick: 0,
            mode: 'manual',
            wallAnchor: new Date('0183-01-01T00:00:00.000Z'),
            turnSeconds: 600,
        });
        const oneMinuteTick = clock.dateToTick(new Date('0183-01-01T00:01:00.000Z'));

        expect(
            projectEffectiveCoreMessageValidUntil(
                {
                    validUntil: new Date('0183-01-02T00:00:00.000Z'),
                    validUntilTick: BigInt(oneMinuteTick),
                },
                clock
            )
        ).toBe('0183-01-01T00:01:00.000Z');
        expect(
            projectEffectiveCoreMessageValidUntil(
                {
                    validUntil: new Date('0183-01-02T00:00:00.000Z'),
                    validUntilTick: BigInt(MAX_SAFE_GAME_TICK),
                },
                clock
            )
        ).toBe('infinite');
        expect(
            projectEffectiveCoreMessageValidUntil(
                { validUntil: new Date('0183-01-02T00:00:00.000Z'), validUntilTick: null },
                clock
            )
        ).toBe('0183-01-02T00:00:00.000Z');
    });

    it('compares stable owner identity instead of only owner presence', () => {
        const reference = databaseSnapshot();
        const core = {
            ...databaseSnapshot(),
            generals: [{ ...databaseSnapshot().generals[0], ownerIdentity: 'owner-b' }],
        };

        expect(reference.generals[0]).toMatchObject({ hasOwner: true, ownerIdentity: 'owner-a' });
        expect(compareTurnSnapshots(reference, core)).toContainEqual({
            path: 'generals[1].ownerIdentity',
            reference: 'owner-a',
            core: 'owner-b',
        });
    });

    it('detects a mutant that marks a generated incoming message as already read', () => {
        const reference = databaseSnapshot();
        const core = databaseSnapshot(71);

        expect(reference.generals[0]?.messageReadState).toEqual({
            unreadPrivateCount: 1,
            unreadDiplomacyCount: 0,
            hasUnreadMessage: true,
        });
        expect(compareTurnSnapshots(reference, core)).toEqual(
            expect.arrayContaining([
                {
                    path: 'generals[1].messageReadState.hasUnreadMessage',
                    reference: true,
                    core: false,
                },
                {
                    path: 'generals[1].messageReadState.unreadPrivateCount',
                    reference: 1,
                    core: 0,
                },
            ])
        );
    });

    it('closes the after selector over created entities and exposes an omission mutant', () => {
        const selector = closeTurnSnapshotSelectorOverCreatedEntities(
            { generalIds: [1], cityIds: [1], nationIds: [1], troopIds: [] },
            { generalIds: [1], cityIds: [1], nationIds: [1], troopIds: [] },
            { generalIds: [1, 2], cityIds: [1], nationIds: [1, 2], troopIds: [2] }
        );
        expect(selector).toMatchObject({ generalIds: [1, 2], nationIds: [1, 2], troopIds: [2] });

        const beforeReference = databaseSnapshot();
        const afterReference = {
            ...databaseSnapshot(),
            generals: [...databaseSnapshot().generals, { id: 2, ownerIdentity: null }],
        };
        const beforeCore = databaseSnapshot();
        const afterCore = databaseSnapshot();
        expect(compareTurnSnapshotDeltas(beforeReference, afterReference, beforeCore, afterCore)).not.toEqual([]);
    });

    it('keeps persisted actor rank rows in the full-lifecycle graph and catches an upsert omission', () => {
        const snapshot = {
            ...databaseSnapshot(),
            rankData: [
                { generalId: 1, nationId: 1, type: 'dedication', value: 1_015 },
                { generalId: 1, nationId: 1, type: 'experience', value: 1_015 },
            ],
        };
        const omitted = {
            ...snapshot,
            rankData: snapshot.rankData.filter((row) => row.type !== 'experience'),
        };

        expect(projectFullLifecycleSnapshotGraph(snapshot).actorRankData).toEqual([
            { nationId: 1, type: 'dedication', value: 1_015 },
            { nationId: 1, type: 'experience', value: 1_015 },
        ]);
        expect(projectFullLifecycleSnapshotGraph(omitted)).not.toEqual(projectFullLifecycleSnapshotGraph(snapshot));
    });

    it('projects command-semantic meta outside the ignored raw meta graph and catches omission mutants', () => {
        const generalMeta = {
            armType: 3,
            explevel: 4,
            dedlevel: 2,
            npc_org: 4,
            text: '의병 소개',
        };
        const generalFields = {
            affinity: 37,
            bornYear: 170,
            deadYear: 210,
            npcState: 4,
            turnTick: 1_027_407n,
        };
        const nationMeta = {
            can_국기변경: 1,
            can_무작위수도이전: 1,
            spy: { 7: 3 },
            collapsed: true,
            rate: 20,
            bill: 100,
            secretlimit: 3,
        };
        const expectedFixture = { generalMeta, generalFields, nationMeta };
        const before = databaseSnapshot(0, { generalMeta: {}, nationMeta: {} });
        const expectedAfter = databaseSnapshot(0, expectedFixture);

        expect(expectedAfter.generals[0]).toMatchObject({
            expLevel: 4,
            dedLevel: 2,
            affinity: 37,
            bornYear: 170,
            deadYear: 210,
            npcState: 4,
            npcOriginalState: 4,
            npcMessage: '의병 소개',
            turnTick: 1_027_407,
            turnSecond: 17,
            turnFraction: 123_450,
        });
        expect(expectedAfter.generals[0]?.commandState).toEqual({ recruitmentArmType: 3 });
        expect(expectedAfter.nations[0]?.commandState).toEqual({
            flagChangesRemaining: 1,
            randomCapitalMovesRemaining: 1,
            spy: [{ cityId: 7, remainingTurns: 3 }],
            collapsed: true,
            rate: 20,
            bill: 100,
            secretLimit: 3,
        });

        const ignoredRawMeta = [/^generals\[[^\]]+\]\.meta(?:\.|$)/, /^nations\[[^\]]+\]\.meta(?:\.|$)/];
        const mutants: Array<{ path: string; snapshot: CanonicalTurnSnapshot }> = [
            {
                path: 'generals[1].commandState.recruitmentArmType',
                snapshot: databaseSnapshot(0, {
                    ...expectedFixture,
                    generalMeta: { ...generalMeta, armType: undefined },
                }),
            },
            {
                path: 'generals[1].expLevel',
                snapshot: databaseSnapshot(0, {
                    ...expectedFixture,
                    generalMeta: { ...generalMeta, explevel: 0 },
                }),
            },
            {
                path: 'generals[1].dedLevel',
                snapshot: databaseSnapshot(0, {
                    ...expectedFixture,
                    generalMeta: { ...generalMeta, dedlevel: 0 },
                }),
            },
            {
                path: 'generals[1].affinity',
                snapshot: databaseSnapshot(0, {
                    ...expectedFixture,
                    generalFields: { ...generalFields, affinity: null },
                }),
            },
            {
                path: 'generals[1].bornYear',
                snapshot: databaseSnapshot(0, {
                    ...expectedFixture,
                    generalFields: { ...generalFields, bornYear: 171 },
                }),
            },
            {
                path: 'generals[1].deadYear',
                snapshot: databaseSnapshot(0, {
                    ...expectedFixture,
                    generalFields: { ...generalFields, deadYear: 211 },
                }),
            },
            {
                path: 'generals[1].npcState',
                snapshot: databaseSnapshot(0, {
                    ...expectedFixture,
                    generalFields: { ...generalFields, npcState: 3 },
                }),
            },
            {
                path: 'generals[1].npcOriginalState',
                snapshot: databaseSnapshot(0, {
                    ...expectedFixture,
                    generalMeta: { ...generalMeta, npc_org: undefined },
                }),
            },
            {
                path: 'generals[1].npcMessage',
                snapshot: databaseSnapshot(0, {
                    ...expectedFixture,
                    generalMeta: { ...generalMeta, text: null },
                }),
            },
            {
                path: 'generals[1].turnSecond',
                snapshot: databaseSnapshot(0, {
                    ...expectedFixture,
                    generalFields: { ...generalFields, turnTick: 1_087_407n },
                }),
            },
            {
                path: 'generals[1].turnFraction',
                snapshot: databaseSnapshot(0, {
                    ...expectedFixture,
                    generalFields: { ...generalFields, turnTick: 1_027_408n },
                }),
            },
            {
                path: 'generals[1].turnTick',
                snapshot: databaseSnapshot(0, {
                    ...expectedFixture,
                    generalFields: { ...generalFields, turnTick: 1_027_408n },
                }),
            },
            {
                path: 'nations[1].commandState.flagChangesRemaining',
                snapshot: databaseSnapshot(0, {
                    generalMeta,
                    generalFields,
                    nationMeta: { ...nationMeta, can_국기변경: 0 },
                }),
            },
            {
                path: 'nations[1].commandState.randomCapitalMovesRemaining',
                snapshot: databaseSnapshot(0, {
                    generalMeta,
                    generalFields,
                    nationMeta: { ...nationMeta, can_무작위수도이전: 0 },
                }),
            },
            {
                path: 'nations[1].commandState.spy',
                snapshot: databaseSnapshot(0, {
                    generalMeta,
                    generalFields,
                    nationMeta: { ...nationMeta, spy: {} },
                }),
            },
            {
                path: 'nations[1].commandState.collapsed',
                snapshot: databaseSnapshot(0, {
                    generalMeta,
                    generalFields,
                    nationMeta: { ...nationMeta, collapsed: false },
                }),
            },
            {
                path: 'nations[1].commandState.rate',
                snapshot: databaseSnapshot(0, {
                    ...expectedFixture,
                    nationMeta: { ...nationMeta, rate: 0 },
                }),
            },
            {
                path: 'nations[1].commandState.bill',
                snapshot: databaseSnapshot(0, {
                    ...expectedFixture,
                    nationMeta: { ...nationMeta, bill: 0 },
                }),
            },
            {
                path: 'nations[1].commandState.secretLimit',
                snapshot: databaseSnapshot(0, {
                    ...expectedFixture,
                    nationMeta: { ...nationMeta, secretlimit: 2 },
                }),
            },
        ];

        for (const mutant of mutants) {
            const differences = compareTurnSnapshotDeltas(before, expectedAfter, before, mutant.snapshot, {
                ignoredPathPatterns: ignoredRawMeta,
            });
            expect(
                differences.some(
                    (difference) => difference.path === mutant.path || difference.path.startsWith(`${mutant.path}[`)
                ),
                mutant.path
            ).toBe(true);
        }
    });
});
