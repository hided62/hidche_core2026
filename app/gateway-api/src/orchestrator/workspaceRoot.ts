import fs from 'node:fs';
import path from 'node:path';

export const resolveWorkspaceRoot = (startDir: string, maxDepth = 5): string => {
    let current = path.resolve(startDir);
    let packageRoot: string | null = null;
    for (let depth = 0; depth <= maxDepth; depth += 1) {
        if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
            return current;
        }
        if (!packageRoot && fs.existsSync(path.join(current, 'package.json'))) {
            packageRoot = current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }
    return packageRoot ?? path.resolve(startDir);
};
