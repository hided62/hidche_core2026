import { execFileSync } from 'node:child_process';
import path from 'node:path';

import type { CanonicalTurnCommandTrace } from './canonical.js';

/**
 * Execute the comparison-only wrapper around Ref's real
 * TurnExecutionHelper::executeGeneralCommandUntil entry point.
 */
export const runReferenceFullLifecycleTrace = (
    workspaceRoot: string,
    request: Record<string, unknown>
): CanonicalTurnCommandTrace => {
    const stackDirectory = path.join(workspaceRoot, 'docker_compose_files/reference');
    const appDirectory = path.resolve(process.env.REF_COMPARE_SOURCE_ROOT ?? path.join(workspaceRoot, 'ref/sam'));
    const runtimeDirectory = path.join(workspaceRoot, 'ref/sam');
    const runner = process.env.TURN_DIFFERENTIAL_CASE_SCRIPT ?? './scripts/run-turn-differential-case.sh';
    const stdout = execFileSync(runner, ['-'], {
        cwd: stackDirectory,
        input: JSON.stringify(request),
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
            ...process.env,
            TURN_DIFFERENTIAL_STACK_DIR: stackDirectory,
            TURN_DIFFERENTIAL_APP_DIR: appDirectory,
            TURN_DIFFERENTIAL_RUNTIME_DIR: runtimeDirectory,
            TURN_DIFFERENTIAL_RUNNER_SCRIPT: path.join(appDirectory, 'hwe/compare/turn_full_lifecycle_trace.php'),
        },
    });
    return JSON.parse(stdout) as CanonicalTurnCommandTrace;
};
