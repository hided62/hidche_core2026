import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const resolveRefRoot = (repositoryRoot = process.cwd()) => {
    if (process.env.SAMMO_REF_ROOT) {
        return path.resolve(process.env.SAMMO_REF_ROOT);
    }

    const candidates = [path.resolve(repositoryRoot, '..', 'ref', 'sam')];
    try {
        const commonDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
            cwd: repositoryRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        candidates.push(path.resolve(path.dirname(commonDir), '..', 'ref', 'sam'));
    } catch {
        // The direct sibling remains the fallback outside a Git checkout.
    }

    return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
};
