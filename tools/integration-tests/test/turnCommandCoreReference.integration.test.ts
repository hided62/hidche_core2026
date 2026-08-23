import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { compareTurnSnapshotDeltas } from '../src/turn-differential/compare.js';
import { runCoreTurnCommandTrace, type TurnCommandFixtureRequest } from '../src/turn-differential/coreCommandTrace.js';
import { orderedSemanticLogStreams } from '../src/turn-differential/logProjection.js';
import {
    projectSemanticTurnMessages,
    projectSemanticUnreadMessageDeltas,
    projectStrictTurnMessageTimeline,
} from '../src/turn-differential/messageProjection.js';
import {
    findTurnDifferentialWorkspaceRoot,
    runReferenceTurnCommandTraceRequest,
} from '../src/turn-differential/referenceSnapshot.js';

const configuredWorkspaceRoot = process.env.TURN_DIFFERENTIAL_WORKSPACE_ROOT;
const workspaceRoot = configuredWorkspaceRoot ?? findTurnDifferentialWorkspaceRoot(process.cwd());
const integration = describe.skipIf(!workspaceRoot || process.env.TURN_DIFFERENTIAL_REFERENCE !== '1');

const ignoredLifecyclePaths = [
    /^generalTurns/,
    /^nationTurns/,
    /^logs/,
    /^messages/,
    /^world\.turnTime$/,
    /^world\.gameNow$/,
    /^generals\[[^\]]+\]\.(?:turnTime|recentWarTime|lastTurn|mySet)(?:\.|$)/,
    /^generals\[1\]\.(?:turnTick|turnSecond|turnFraction)$/,
    /^generals\[[^\]]+\]\.meta(?:\.|$)/,
    /^nations\[[^\]]+\]\.meta(?:\.|$)/,
];

const comparedLifecycleIgnoredPaths = [
    /^nationTurns/,
    /^logs/,
    /^messages/,
    /^world\.turnTime$/,
    /^world\.gameNow$/,
    /^generalTurns\[[^\]]+\]\.args(?:\.|$)/,
    /^generals\[[^\]]+\]\.(?:lastTurn|recentWarTime|turnTime)(?:\.|$)/,
    /^generals\[[^\]]+\]\.meta(?:\.|$)/,
    /^nations\[[^\]]+\]\.meta(?:\.|$)/,
];

const timestampMillis = (value: unknown): number => {
    const raw = String(value);
    const normalized = raw.includes('T') ? raw : `${raw.replace(' ', 'T').replace(/\.(\d{3})\d*$/, '.$1')}Z`;
    return new Date(normalized).getTime();
};

const semanticLogSignatures = (logs: Array<Record<string, unknown>>): string[] => orderedSemanticLogStreams(logs);

const readFixture = (relativePath: string): TurnCommandFixtureRequest => {
    const stackRoot = path.join(workspaceRoot!, 'docker_compose_files/reference');
    const fixture = JSON.parse(
        fs.readFileSync(path.join(stackRoot, relativePath), 'utf8')
    ) as TurnCommandFixtureRequest;
    return {
        ...fixture,
        setup: {
            ...fixture.setup,
            isolateWorld: true,
            world: {
                ...fixture.setup?.world,
                hiddenSeed: 'turn-command-differential-seed',
                freezeClock: true,
            },
            generals: fixture.setup?.generals?.map((general) => ({
                ...general,
                personality: 'None',
                specialDomestic: 'None',
                specialWar: 'None',
                itemHorse: 'None',
                itemWeapon: 'None',
                itemBook: 'None',
                itemExtra: 'None',
            })),
        },
    };
};

integration('core ↔ legacy command-boundary differential', () => {
    it.each([
        ['nation declaration', 'fixtures/turn-differential/nation-declaration.json'],
        ['live sortie conquest', 'fixtures/turn-differential/live-sortie-conquest.json'],
        [
            'live sortie collapsed nation conflict cleanup',
            'fixtures/turn-differential/live-sortie-collapse-conflict.json',
        ],
        ['live sortie against a defending general', 'fixtures/turn-differential/live-sortie-defender.json'],
        [
            'live sortie against multiple defending generals',
            'fixtures/turn-differential/live-sortie-multiple-defenders.json',
        ],
        ['live sortie supply retreat', 'fixtures/turn-differential/live-sortie-supply-retreat.json'],
        ['live sortie noncapital conquest', 'fixtures/turn-differential/live-sortie-noncapital-conquest.json'],
        ['live sortie emergency capital', 'fixtures/turn-differential/live-sortie-emergency-capital.json'],
        ['live sortie conflict arbitration', 'fixtures/turn-differential/live-sortie-conflict-arbitration.json'],
        ['live sortie tied conflict', 'fixtures/turn-differential/live-sortie-conflict-tie.json'],
        ['live sortie outer lifecycle: conquest', 'fixtures/turn-differential/live-sortie-conquest.json'],
        [
            'live sortie outer lifecycle: collapsed nation conflict cleanup',
            'fixtures/turn-differential/live-sortie-collapse-conflict.json',
        ],
        ['live sortie outer lifecycle: defender', 'fixtures/turn-differential/live-sortie-defender.json'],
        [
            'live sortie outer lifecycle: multiple defenders',
            'fixtures/turn-differential/live-sortie-multiple-defenders.json',
        ],
        ['live sortie outer lifecycle: supply retreat', 'fixtures/turn-differential/live-sortie-supply-retreat.json'],
        [
            'live sortie outer lifecycle: noncapital conquest',
            'fixtures/turn-differential/live-sortie-noncapital-conquest.json',
        ],
        [
            'live sortie outer lifecycle: emergency capital',
            'fixtures/turn-differential/live-sortie-emergency-capital.json',
        ],
        [
            'live sortie outer lifecycle: conflict arbitration',
            'fixtures/turn-differential/live-sortie-conflict-arbitration.json',
        ],
        ['live sortie outer lifecycle: tied conflict', 'fixtures/turn-differential/live-sortie-conflict-tie.json'],
    ])(
        '%s matches command RNG and canonical state delta',
        async (label, fixturePath) => {
            const request = readFixture(fixturePath);
            request.includeLifecycle = label.startsWith('live sortie outer lifecycle:');
            if (request.action === 'che_출병') {
                request.observe!.includeNationHistoryLogs = true;
                request.observe!.includeGlobalHistoryLogs = true;
            }
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);
            if (fixturePath.endsWith('live-sortie-multiple-defenders.json')) {
                for (const generalId of [2, 3]) {
                    const beforeGeneral = reference.before.generals.find((general) => general.id === generalId);
                    const afterGeneral = reference.after.generals.find((general) => general.id === generalId);
                    expect(Number(beforeGeneral?.crew)).toBeGreaterThan(0);
                    expect(Number(afterGeneral?.crew)).toBeLessThan(Number(beforeGeneral?.crew));
                }
                const beforeCity = reference.before.cities.find((city) => city.id === 70);
                const afterCity = reference.after.cities.find((city) => city.id === 70);
                expect(Number(afterCity?.defence)).toBeLessThan(Number(beforeCity?.defence));
            }
            if (fixturePath.endsWith('live-sortie-supply-retreat.json')) {
                const retreatLogs = reference.after.logs.filter(
                    (log) => (Number(log.id) || 0) > reference.before.watermarks.historyLogId
                );
                expect(retreatLogs.some((log) => String(log.text).includes('병량 부족'))).toBe(true);
                expect(reference.after.cities.find((city) => city.id === 70)?.nationId).toBe(1);
            }
            if (fixturePath.endsWith('live-sortie-noncapital-conquest.json')) {
                expect(reference.after.cities.find((city) => city.id === 70)?.nationId).toBe(1);
                expect(reference.after.cities.find((city) => city.id === 71)?.nationId).toBe(2);
                expect(reference.after.nations.some((nation) => nation.id === 2)).toBe(true);
                expect(reference.after.generals.find((general) => general.id === 2)?.nationId).toBe(2);
            }
            if (fixturePath.endsWith('live-sortie-emergency-capital.json')) {
                const defenderNation = reference.after.nations.find((nation) => nation.id === 2);
                expect(defenderNation?.capitalCityId).toBe(71);
                expect(defenderNation?.gold).toBe(50_000);
                expect(defenderNation?.rice).toBe(40_000);
                expect(reference.after.generals.find((general) => general.id === 2)).toMatchObject({
                    nationId: 2,
                    cityId: 71,
                    atmos: 80,
                });
                expect(reference.after.cities.find((city) => city.id === 71)?.supplyState).toBe(1);
            }
            if (fixturePath.endsWith('live-sortie-collapse-conflict.json')) {
                expect(reference.before.cities.find((city) => city.id === 71)?.conflict).toEqual({ 2: 1234 });
                expect(reference.after.nations.some((nation) => nation.id === 2)).toBe(false);
                expect(Object.keys(reference.after.cities.find((city) => city.id === 71)?.conflict ?? {})).toEqual([]);
                expect(Object.keys(core.after.cities.find((city) => city.id === 71)?.conflict ?? {})).toEqual([]);
            }
            if (fixturePath.endsWith('live-sortie-conflict-arbitration.json')) {
                expect(reference.before.cities.find((city) => city.id === 70)?.conflict).toEqual({ 3: 10_000 });
                expect(reference.after.cities.find((city) => city.id === 70)).toMatchObject({
                    nationId: 3,
                    conflict: {},
                });
                expect(reference.after.generals.find((general) => general.id === 1)?.cityId).toBe(3);
                const arbitrationLogs = reference.after.logs.filter(
                    (log) => (Number(log.id) || 0) > reference.before.watermarks.historyLogId
                );
                expect(arbitrationLogs.some((log) => String(log.text).includes('【분쟁협상】'))).toBe(true);
            }
            if (fixturePath.endsWith('live-sortie-conflict-tie.json')) {
                expect(reference.after.cities.find((city) => city.id === 70)).toMatchObject({
                    nationId: 4,
                    conflict: {},
                });
                expect(reference.after.generals.find((general) => general.id === 1)?.cityId).toBe(3);
            }
            if (request.includeLifecycle) {
                const actorGeneralId = request.actorGeneralId;
                const beforeActor = reference.before.generals.find((general) => general.id === actorGeneralId);
                const afterActor = reference.after.generals.find((general) => general.id === actorGeneralId);
                const coreBeforeActor = core.before.generals.find((general) => general.id === actorGeneralId);
                const coreAfterActor = core.after.generals.find((general) => general.id === actorGeneralId);
                const expectedTurnMinutes = Number(reference.before.world.tickMinutes);
                expect(
                    reference.before.generalTurns.find(
                        (turn) => turn.generalId === actorGeneralId && turn.turnIndex === 0
                    )?.action
                ).toBe('che_출병');
                expect(
                    reference.after.generalTurns.find(
                        (turn) => turn.generalId === actorGeneralId && turn.turnIndex === 0
                    )?.action
                ).toBe('휴식');
                expect(timestampMillis(afterActor?.turnTime) - timestampMillis(beforeActor?.turnTime)).toBe(
                    expectedTurnMinutes * 60_000
                );
                expect(timestampMillis(coreAfterActor?.turnTime) - timestampMillis(coreBeforeActor?.turnTime)).toBe(
                    expectedTurnMinutes * 60_000
                );
                expect(timestampMillis(coreAfterActor?.turnTime)).toBe(timestampMillis(afterActor?.turnTime));
                expect(afterActor?.mySet).toBe(Math.min(9, Number(beforeActor?.mySet) + 3));
                expect(coreAfterActor?.mySet).toBe(afterActor?.mySet);
                expect(coreAfterActor?.killTurn).toBe(afterActor?.killTurn);
                expect(afterActor?.lastTurn).not.toBeNull();
                expect((coreAfterActor?.lastTurn as Record<string, unknown>)?.command).toBe(
                    (afterActor?.lastTurn as Record<string, unknown>)?.command
                );
                for (const referenceGeneral of reference.after.generals) {
                    const coreRecentWar = core.after.generals.find(
                        (general) => general.id === referenceGeneral.id
                    )?.recentWarTime;
                    if (referenceGeneral.recentWarTime == null) {
                        expect(coreRecentWar).toBeNull();
                    } else {
                        expect(coreRecentWar).not.toBeNull();
                        expect(timestampMillis(coreRecentWar)).toBe(timestampMillis(referenceGeneral.recentWarTime));
                    }
                }
            }

            expect(core.execution.outcome).toMatchObject({
                requestedAction: request.action,
                actionKey: request.action,
                usedFallback: false,
            });
            expect(reference.execution.outcome).toMatchObject({ completed: true });
            expect(core.rng).toEqual(reference.rng);
            const messageAfterId = reference.before.watermarks.messageId;
            const coreMessages = projectSemanticTurnMessages(core.after.messages, messageAfterId);
            const referenceMessages = projectSemanticTurnMessages(reference.after.messages, messageAfterId);
            const coreMessageTimeline = projectStrictTurnMessageTimeline(core.before, core.after, messageAfterId);
            const referenceMessageTimeline = projectStrictTurnMessageTimeline(
                reference.before,
                reference.after,
                messageAfterId
            );
            expect({
                messages: coreMessages,
                unreadDeltas: projectSemanticUnreadMessageDeltas(core.before, core.after),
                timeline: coreMessageTimeline,
            }).toEqual({
                messages: referenceMessages,
                unreadDeltas: projectSemanticUnreadMessageDeltas(reference.before, reference.after),
                timeline: referenceMessageTimeline,
            });
            expect(referenceMessageTimeline.usesSingleTick).toBe(true);
            if (request.action === 'che_출병') {
                const generalLogWatermark = reference.before.watermarks.logId;
                const historyLogWatermark = reference.before.watermarks.historyLogId;
                const referenceAddedLogs = reference.after.logs.filter((entry) =>
                    String(entry.scope).toLowerCase() === 'nation' ||
                    (String(entry.scope).toLowerCase() === 'system' &&
                        String(entry.category).toLowerCase() === 'history')
                        ? (Number(entry.id) || 0) > historyLogWatermark
                        : (Number(entry.id) || 0) > generalLogWatermark
                );
                expect(semanticLogSignatures(core.after.logs)).toEqual(semanticLogSignatures(referenceAddedLogs));
            }
            expect(
                compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                    ignoredPathPatterns:
                        request.action === 'che_출병'
                            ? request.includeLifecycle
                                ? comparedLifecycleIgnoredPaths
                                : ignoredLifecyclePaths
                            : [...ignoredLifecyclePaths, /^generals\[[^\]]+\]\.killTurn(?:\.|$)/],
                })
            ).toEqual([]);
        },
        120_000
    );

    it('matches the Ref receiver-only scout message on a positive collapse draw', async () => {
        const request = readFixture('fixtures/turn-differential/live-sortie-conquest.json');
        request.setup!.world!.hiddenSeed = 'collapse-scout-positive-4';
        const reference = runReferenceTurnCommandTraceRequest(
            workspaceRoot!,
            request as unknown as Record<string, unknown>
        );
        const core = await runCoreTurnCommandTrace(request, reference.before);

        const messageAfterId = reference.before.watermarks.messageId;
        const coreMessages = projectSemanticTurnMessages(core.after.messages, messageAfterId);
        const referenceMessages = projectSemanticTurnMessages(reference.after.messages, messageAfterId);
        const coreTimeline = projectStrictTurnMessageTimeline(core.before, core.after, messageAfterId);
        const referenceTimeline = projectStrictTurnMessageTimeline(reference.before, reference.after, messageAfterId);
        const coreUnread = projectSemanticUnreadMessageDeltas(core.before, core.after);
        const referenceUnread = projectSemanticUnreadMessageDeltas(reference.before, reference.after);

        expect(core.rng).toEqual(reference.rng);
        expect(coreMessages).toEqual(referenceMessages);
        expect(coreTimeline).toEqual(referenceTimeline);
        expect(coreUnread).toEqual(referenceUnread);
        expect(referenceTimeline.usesSingleTick).toBe(true);
        expect(referenceMessages).toHaveLength(1);
        expect(referenceMessages[0]).toMatchObject({
            mailbox: 2,
            type: 'private',
            sourceId: 1,
            destinationId: 2,
            createdAt: referenceTimeline.beforeGameNow,
            validUntil: { kind: 'infinite' },
            source: {
                generalId: 1,
                nationId: 1,
                nationName: '공격국',
            },
            destination: {
                generalId: 2,
                nationId: 0,
                nationName: '재야',
                color: '#000000',
            },
            text: '공격국으로 망명 권유 서신',
            option: { action: 'scout' },
        });
        expect(referenceMessages[0]!.source.icon).toBe(referenceMessages[0]!.destination.icon);
        expect(referenceMessages[0]!.source.icon).toMatch(/\/default\.jpg$/u);
        expect(referenceUnread.find((entry) => entry.generalId === 2)).toMatchObject({
            unreadPrivateDelta: 1,
            hasUnreadMessage: true,
        });
        expect(
            compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                ignoredPathPatterns: ignoredLifecyclePaths,
            })
        ).toEqual([]);
    }, 120_000);
});
