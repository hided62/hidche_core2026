import { describe, expect, it } from 'vitest';

import {
    findTurnDifferentialWorkspaceRoot,
    runReferenceTurnCommandTrace,
} from '../src/turn-differential/referenceSnapshot.js';

const configuredWorkspaceRoot = process.env.TURN_DIFFERENTIAL_WORKSPACE_ROOT;
const workspaceRoot = configuredWorkspaceRoot ?? findTurnDifferentialWorkspaceRoot(process.cwd());
const integration = describe.skipIf(!workspaceRoot || process.env.TURN_DIFFERENTIAL_REFERENCE !== '1');

integration('legacy command trace runner', () => {
    it('runs a nation declaration against a disposable cloned database', () => {
        const trace = runReferenceTurnCommandTrace(
            workspaceRoot!,
            'fixtures/turn-differential/nation-declaration.json'
        );

        expect(trace.execution).toMatchObject({
            kind: 'nation',
            action: 'che_선전포고',
            seedDomain: 'nationCommand',
        });
        expect(trace.rng).toEqual([]);
        expect(trace.after.diplomacy).toEqual([
            expect.objectContaining({ fromNationId: 1, toNationId: 2, state: 1, term: 24 }),
            expect.objectContaining({ fromNationId: 2, toNationId: 1, state: 1, term: 24 }),
        ]);
        const addedMessages = trace.after.messages.slice(trace.before.messages.length);
        expect(addedMessages).toHaveLength(2);
    });

    it('runs live sortie through conquest and nation collapse', () => {
        const trace = runReferenceTurnCommandTrace(
            workspaceRoot!,
            'fixtures/turn-differential/live-sortie-conquest.json'
        );

        expect(trace.execution).toMatchObject({
            kind: 'general',
            action: 'che_출병',
            seedDomain: 'generalCommand',
        });
        expect(trace.rng).toEqual([
            {
                seq: 0,
                operation: 'nextInt',
                arguments: { maxInclusive: 0 },
                result: 0,
            },
        ]);
        expect(trace.after.cities).toContainEqual(expect.objectContaining({ id: 70, nationId: 1 }));
        expect(trace.after.nations).not.toContainEqual(expect.objectContaining({ id: 2 }));
        expect(trace.after.generals).toContainEqual(expect.objectContaining({ id: 2, nationId: 0 }));
        expect(trace.after.logs.some((log) => String(log.text).includes('점령'))).toBe(true);
        expect(trace.after.logs.some((log) => String(log.text).includes('멸망'))).toBe(true);
    });
});
