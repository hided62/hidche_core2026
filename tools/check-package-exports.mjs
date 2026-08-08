import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const packageRoot = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) {
    throw new Error('Usage: node tools/check-package-exports.mjs <package-directory>');
}

const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
const targets = new Set();
for (const descriptor of Object.values(manifest.exports ?? {})) {
    if (typeof descriptor === 'string') {
        targets.add(descriptor);
        continue;
    }
    if (descriptor && typeof descriptor === 'object') {
        for (const target of Object.values(descriptor)) {
            if (typeof target === 'string') targets.add(target);
        }
    }
}

for (const target of targets) {
    const absolute = path.resolve(packageRoot, target);
    if (absolute !== packageRoot && !absolute.startsWith(`${packageRoot}${path.sep}`)) {
        throw new Error(`Package export escapes its package directory: ${target}`);
    }
    await access(absolute);
}

process.stdout.write(`Validated ${targets.size} package export targets for ${manifest.name}.\n`);
