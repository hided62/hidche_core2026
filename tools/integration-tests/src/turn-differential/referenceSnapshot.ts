import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type { CanonicalTurnCommandTrace, CanonicalTurnSnapshot, TurnSnapshotSelector } from './canonical.js';

const withProjectedGeneralMeta = (snapshot: CanonicalTurnSnapshot): CanonicalTurnSnapshot => ({
    ...snapshot,
    generals: snapshot.generals.map((general) => {
        const meta =
            typeof general.meta === 'object' && general.meta !== null && !Array.isArray(general.meta)
                ? (general.meta as Record<string, unknown>)
                : {};
        const value = meta.max_domestic_critical;
        return {
            ...general,
            maxDomesticCritical: typeof value === 'number' && Number.isFinite(value) ? value : 0,
        };
    }),
});

const withProjectedTraceMeta = (trace: CanonicalTurnCommandTrace): CanonicalTurnCommandTrace => ({
    ...trace,
    before: withProjectedGeneralMeta(trace.before),
    after: withProjectedGeneralMeta(trace.after),
});

const referenceRunnerEnvironment = (workspaceRoot: string, stackDirectory: string): NodeJS.ProcessEnv => {
    const compareSourceRoot = process.env.REF_COMPARE_SOURCE_ROOT;
    return {
        ...process.env,
        TURN_DIFFERENTIAL_STACK_DIR: stackDirectory,
        ...(compareSourceRoot
            ? {
                  TURN_DIFFERENTIAL_APP_DIR: path.resolve(compareSourceRoot),
                  TURN_DIFFERENTIAL_RUNTIME_DIR: path.join(workspaceRoot, 'ref/sam'),
              }
            : {}),
    };
};

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
    return withProjectedGeneralMeta(JSON.parse(stdout) as CanonicalTurnSnapshot);
};

export const runReferenceTurnCommandTrace = (workspaceRoot: string, fixturePath: string): CanonicalTurnCommandTrace => {
    const stackDirectory = path.join(workspaceRoot, 'docker_compose_files/reference');
    const resolvedFixture = path.resolve(stackDirectory, fixturePath);
    const fixtureRoot = path.join(stackDirectory, 'fixtures/turn-differential');
    if (resolvedFixture !== fixtureRoot && !resolvedFixture.startsWith(`${fixtureRoot}${path.sep}`)) {
        throw new Error(`Reference turn fixture must be under ${fixtureRoot}`);
    }
    const runner = process.env.TURN_DIFFERENTIAL_CASE_SCRIPT ?? './scripts/run-turn-differential-case.sh';
    const stdout = execFileSync(runner, [resolvedFixture], {
        cwd: stackDirectory,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
            ...referenceRunnerEnvironment(workspaceRoot, stackDirectory),
        },
    });
    return withProjectedTraceMeta(JSON.parse(stdout) as CanonicalTurnCommandTrace);
};

export const runReferenceTurnCommandTraceRequest = (
    workspaceRoot: string,
    request: Record<string, unknown>
): CanonicalTurnCommandTrace => {
    const stackDirectory = path.join(workspaceRoot, 'docker_compose_files/reference');
    const runner = process.env.TURN_DIFFERENTIAL_CASE_SCRIPT ?? './scripts/run-turn-differential-case.sh';
    const stdout = execFileSync(runner, ['-'], {
        cwd: stackDirectory,
        input: JSON.stringify(request),
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
            ...referenceRunnerEnvironment(workspaceRoot, stackDirectory),
        },
    });
    return withProjectedTraceMeta(JSON.parse(stdout) as CanonicalTurnCommandTrace);
};
