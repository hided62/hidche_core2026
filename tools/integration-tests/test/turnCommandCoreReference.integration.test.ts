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
    /^generals\[[^\]]+\]\.(?:turnTime|recentWarTime|lastTurn|killTurn|mySet)(?:\.|$)/,
    /^generals\[[^\]]+\]\.meta(?:\.|$)/,
    /^nations\[[^\]]+\]\.meta(?:\.|$)/,
];

const readFixture = (relativePath: string): TurnCommandFixtureRequest => {
    const stackRoot = path.join(workspaceRoot!, 'docker_compose_files/reference');
    const fixture = JSON.parse(
        fs.readFileSync(path.join(stackRoot, relativePath), 'utf8')
    ) as TurnCommandFixtureRequest;
    return {
        ...fixture,
        setup: {
            ...fixture.setup,
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
    ])(
        '%s matches command RNG and canonical state delta',
        async (_label, fixturePath) => {
            const request = readFixture(fixturePath);
            const reference = runReferenceTurnCommandTraceRequest(
                workspaceRoot!,
                request as unknown as Record<string, unknown>
            );
            const core = await runCoreTurnCommandTrace(request, reference.before);

            expect(core.execution.outcome).toMatchObject({
                requestedAction: request.action,
                actionKey: request.action,
                usedFallback: false,
            });
            expect(reference.execution.outcome).toMatchObject({ completed: true });
            expect(core.rng).toEqual(reference.rng);
            expect(
                compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
                    ignoredPathPatterns: ignoredLifecyclePaths,
                })
            ).toEqual([]);
        },
        120_000
    );
});
