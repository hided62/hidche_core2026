import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { compareTurnSnapshotDeltas } from '../src/turn-differential/compare.js';
import { runCoreTurnCommandTrace, type TurnCommandFixtureRequest } from '../src/turn-differential/coreCommandTrace.js';
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
    /^generals\[[^\]]+\]\.(?:turnTime|recentWarTime|lastTurn|mySet)(?:\.|$)/,
    /^generals\[[^\]]+\]\.meta(?:\.|$)/,
    /^nations\[[^\]]+\]\.meta(?:\.|$)/,
];

const normalizeStoredLogText = (value: unknown): string =>
    String(value)
        .replace(/^(?:<C>●<\/>|<S>◆<\/>|<R>★<\/>)(?:(?:\d+년 )?\d+월:|\d+년:)?/, '')
        .replace(/<span class='hidden_but_copyable'>(.*?)<\/span>/g, '$1')
        .replace(/ <1>\d{2}:\d{2}<\/>$/, '');

const semanticLogSignatures = (logs: Array<Record<string, unknown>>): string[] =>
    logs
        .map((entry) =>
            JSON.stringify({
                scope: String(entry.scope).toLowerCase(),
                category: String(entry.category).toLowerCase(),
                generalId: Number(entry.generalId) || null,
                nationId: Number(entry.nationId) || null,
                text: normalizeStoredLogText(entry.text),
            })
        )
        .sort();

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
    ])(
        '%s matches command RNG and canonical state delta',
        async (_label, fixturePath) => {
            const request = readFixture(fixturePath);
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

            expect(core.execution.outcome).toMatchObject({
                requestedAction: request.action,
                actionKey: request.action,
                usedFallback: false,
            });
            expect(reference.execution.outcome).toMatchObject({ completed: true });
            expect(core.rng).toEqual(reference.rng);
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
                            ? ignoredLifecyclePaths
                            : [...ignoredLifecyclePaths, /^generals\[[^\]]+\]\.killTurn(?:\.|$)/],
                })
            ).toEqual([]);
        },
        120_000
    );
});
