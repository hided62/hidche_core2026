import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type { CanonicalTurnCommandTrace, CanonicalTurnSnapshot, TurnSnapshotSelector } from './canonical.js';

export const findTurnDifferentialWorkspaceRoot = (start: string): string | null => {
    let current = path.resolve(start);
    while (true) {
        if (
            fs.existsSync(path.join(current, 'docker_compose_files/reference/compose.yml')) &&
            fs.existsSync(path.join(current, 'ref/sam/hwe/compare/turn_state_snapshot.php'))
        ) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
};

export const readReferenceDatabaseSnapshot = (
    workspaceRoot: string,
    selector: TurnSnapshotSelector
): CanonicalTurnSnapshot => {
    const stdout = execFileSync(
        'docker',
        [
            'compose',
            '--profile',
            'tools',
            'run',
            '--rm',
            '-T',
            'time-tool',
            'php',
            '/var/www/html/hwe/compare/turn_state_snapshot.php',
        ],
        {
            cwd: path.join(workspaceRoot, 'docker_compose_files/reference'),
            input: JSON.stringify({ observe: selector }),
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }
    );
    return JSON.parse(stdout) as CanonicalTurnSnapshot;
};

export const runReferenceTurnCommandTrace = (workspaceRoot: string, fixturePath: string): CanonicalTurnCommandTrace => {
    const stackDirectory = path.join(workspaceRoot, 'docker_compose_files/reference');
    const resolvedFixture = path.resolve(stackDirectory, fixturePath);
    const fixtureRoot = path.join(stackDirectory, 'fixtures/turn-differential');
    if (resolvedFixture !== fixtureRoot && !resolvedFixture.startsWith(`${fixtureRoot}${path.sep}`)) {
        throw new Error(`Reference turn fixture must be under ${fixtureRoot}`);
    }
    const stdout = execFileSync('./scripts/run-turn-differential-case.sh', [resolvedFixture], {
        cwd: stackDirectory,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(stdout) as CanonicalTurnCommandTrace;
};
