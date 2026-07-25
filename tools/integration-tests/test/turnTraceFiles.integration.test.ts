import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

import { canonicalizeTurnCommandArgs, type CanonicalTurnCommandTrace } from '../src/turn-differential/canonical.js';
import { compareTurnSnapshotDeltas } from '../src/turn-differential/compare.js';

const referencePath = process.env.TURN_REFERENCE_TRACE;
const corePath = process.env.TURN_CORE_TRACE;
const integration = describe.skipIf(!referencePath || !corePath);

const readTrace = (filePath: string): CanonicalTurnCommandTrace =>
    JSON.parse(fs.readFileSync(filePath, 'utf8')) as CanonicalTurnCommandTrace;

integration('saved ref and core turn command traces', () => {
    it('has the same command identity, RNG calls, and semantic state delta', () => {
        const reference = readTrace(referencePath!);
        const core = readTrace(corePath!);

        expect(core.execution).toMatchObject({
            kind: reference.execution.kind,
            actorGeneralId: reference.execution.actorGeneralId,
            action: reference.execution.action,
            seedDomain: reference.execution.seedDomain,
        });
        expect(canonicalizeTurnCommandArgs(core.execution.args)).toEqual(
            canonicalizeTurnCommandArgs(reference.execution.args)
        );
        expect(core.rng).toEqual(reference.rng);
        const differences = compareTurnSnapshotDeltas(reference.before, reference.after, core.before, core.after, {
            ignoredPathPatterns: [
                /^logs\[[^\]]+\]\.id$/,
                /^logs\[[^\]]+\]\.scope$/,
                /^logs\[[^\]]+\]\.nationId$/,
                /^messages(?:\[|$)/,
                /\.turnTime$/,
                /^world\.turnTime$/,
            ],
        });
        expect(differences, JSON.stringify(differences, null, 2)).toEqual([]);
    });
});
