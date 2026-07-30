import { describe, expect, it } from 'vitest';

import {
    findTurnDifferentialWorkspaceRoot,
    readReferenceDatabaseSnapshot,
} from '../src/turn-differential/referenceSnapshot.js';

const configuredWorkspaceRoot = process.env.TURN_DIFFERENTIAL_WORKSPACE_ROOT;
const workspaceRoot = configuredWorkspaceRoot ?? findTurnDifferentialWorkspaceRoot(process.cwd());
const integration = describe.skipIf(!workspaceRoot || process.env.TURN_DIFFERENTIAL_REFERENCE !== '1');

integration('legacy turn state snapshot adapter', () => {
    it('exports a read-only canonical snapshot from the isolated reference service', () => {
        const snapshot = readReferenceDatabaseSnapshot(workspaceRoot!, {
            generalIds: [],
            cityIds: [],
            nationIds: [],
        });

        expect(snapshot).toMatchObject({
            schemaVersion: 1,
            engine: 'ref',
            world: {
                year: expect.any(Number),
                month: expect.any(Number),
                tickMinutes: expect.any(Number),
            },
            generals: [],
            cities: [],
            nations: [],
        });
    });
});
