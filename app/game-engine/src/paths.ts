import fs from 'node:fs';
import path from 'node:path';

const WORKSPACE_MARKERS = ['pnpm-workspace.yaml'];

const hasWorkspaceMarker = (dir: string): boolean =>
    WORKSPACE_MARKERS.some((marker) => fs.existsSync(path.join(dir, marker)));

export const resolveWorkspaceRoot = (
    startDir: string = process.env.GAME_WORKSPACE_ROOT ?? process.env.GATEWAY_WORKSPACE_ROOT ?? process.cwd(),
    maxDepth = 6
): string => {
    let current = path.resolve(startDir);
    for (let depth = 0; depth <= maxDepth; depth += 1) {
        if (hasWorkspaceMarker(current)) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }
    return path.resolve(startDir);
};
