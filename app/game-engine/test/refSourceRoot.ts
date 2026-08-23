import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CORE_REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const refSourceCandidates = (): string[] => {
    if (process.env.SAMMO_REF_ROOT) {
        return [path.resolve(process.env.SAMMO_REF_ROOT)];
    }

    const candidates = [path.resolve(CORE_REPOSITORY_ROOT, '..', 'ref', 'sam')];
    try {
        const commonDirectory = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
            cwd: CORE_REPOSITORY_ROOT,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        candidates.push(path.resolve(path.dirname(commonDirectory), '..', 'ref', 'sam'));
    } catch {
        // The ordinary sibling checkout remains the fallback outside a Git worktree.
    }

    return [...new Set(candidates)];
};

export const hasRefSourceRoot = (): boolean => {
    if (process.env.SAMMO_REQUIRE_REF_SOURCE === '1' || process.env.SAMMO_REF_ROOT) {
        return true;
    }
    return refSourceCandidates().some((candidate) => existsSync(candidate));
};

export const resolveRefSourceRoot = (): string => {
    const candidates = refSourceCandidates();
    const resolvedRoot = candidates.find((candidate) => existsSync(candidate));
    if (!resolvedRoot) {
        if (process.env.SAMMO_REF_ROOT) {
            throw new Error(`SAMMO_REF_ROOT does not exist: ${candidates[0]}`);
        }
        throw new Error(`Ref source checkout was not found. Checked: ${candidates.join(', ')}`);
    }
    return resolvedRoot;
};
