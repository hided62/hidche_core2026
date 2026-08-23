import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createCoreTurnCommandProfile, runCoreTurnCommandTrace } from '../src/turn-differential/coreCommandTrace.js';
import { runReferenceFullLifecycleTrace } from '../src/turn-differential/fullLifecycleTrace.js';
import {
    addedFullLifecycleReferenceLogs,
    fullLifecycleTurnCommandRequest as request,
    projectFullLifecycleSnapshotGraph,
} from '../src/turn-differential/fullLifecycleFixture.js';
import { normalizeStoredTurnLogText, orderedSemanticLogStreams } from '../src/turn-differential/logProjection.js';
import { findTurnDifferentialWorkspaceRoot } from '../src/turn-differential/referenceSnapshot.js';

const workspaceRoot = process.env.TURN_DIFFERENTIAL_WORKSPACE_ROOT ?? findTurnDifferentialWorkspaceRoot(process.cwd());
const referenceSourceRoot = workspaceRoot
    ? path.resolve(process.env.REF_COMPARE_SOURCE_ROOT ?? path.join(workspaceRoot, 'ref/sam'))
    : null;
const hasFullLifecycleRunner =
    referenceSourceRoot !== null &&
    fs.existsSync(path.join(referenceSourceRoot, 'hwe/compare/turn_full_lifecycle_trace.php'));
const integration = describe.skipIf(
    !workspaceRoot || !hasFullLifecycleRunner || process.env.TURN_DIFFERENTIAL_REFERENCE !== '1'
);

const asRecord = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

describe('full lifecycle fixture profile closure', () => {
    it('keeps both the queued nation and general command executable', () => {
        const profile = createCoreTurnCommandProfile(request);

        expect(profile.general).toContain('che_훈련');
        expect(profile.nation).toContain('che_국호변경');
    });
});

integration('Ref/Core full reserved-turn lifecycle topology', () => {
    it('runs nation then general and persists both queue shifts in the same actor turn', async () => {
        const reference = runReferenceFullLifecycleTrace(workspaceRoot!, {
            ...request,
            generalAction: request.action,
            generalArgs: request.args,
            nationAction: 'che_국호변경',
            nationArgs: { nationName: '수명주기국' },
        } as unknown as Record<string, unknown>);
        const core = await runCoreTurnCommandTrace(request, reference.before);

        const referencePhases = asRecord(reference.execution.outcome).phases as Array<Record<string, unknown>>;
        expect(referencePhases.map((entry) => entry.phase)).toEqual([
            'preprocess',
            'block',
            'nation_command',
            'nation_command_resolved',
            'general_command',
            'general_command_resolved',
            'queues_shifted',
            'turn_state_advanced',
            'persisted',
        ]);
        expect(
            referencePhases
                .filter((entry) => entry.phase === 'nation_command' || entry.phase === 'general_command')
                .map((entry) => [entry.phase, entry.action])
        ).toEqual([
            ['nation_command', 'che_국호변경'],
            ['general_command', 'che_훈련'],
        ]);
        expect(referencePhases.find((entry) => entry.phase === 'queues_shifted')).toMatchObject({
            generalAction: '휴식',
            nationAction: '휴식',
        });

        const coreLifecycleActions = asRecord(core.execution.outcome).lifecycleActions as Array<
            Record<string, unknown>
        >;
        expect(coreLifecycleActions.map((entry) => [entry.kind, entry.requestedAction, entry.usedFallback])).toEqual([
            ['nation', 'che_국호변경', false],
            ['general', 'che_훈련', false],
        ]);
        expect(projectFullLifecycleSnapshotGraph(core.after)).toEqual(
            projectFullLifecycleSnapshotGraph(reference.after)
        );

        const referenceLogs = addedFullLifecycleReferenceLogs(reference.before, reference.after);
        expect(orderedSemanticLogStreams(core.after.logs)).toEqual(orderedSemanticLogStreams(referenceLogs));
        const generalActionTexts = referenceLogs
            .filter((entry) => String(entry.category).toLowerCase() === 'action')
            .map((entry) => normalizeStoredTurnLogText(entry.text));
        expect(generalActionTexts.findIndex((text) => text.includes('국호를'))).toBeLessThan(
            generalActionTexts.findIndex((text) => text.includes('훈련치가'))
        );

        const persisted = referencePhases.find((entry) => entry.phase === 'persisted');
        const referenceActor = reference.after.generals.find((entry) => entry.id === 1);
        expect(persisted).toMatchObject({
            killTurn: referenceActor?.killTurn,
            mySet: referenceActor?.mySet,
        });
    }, 180_000);
});
