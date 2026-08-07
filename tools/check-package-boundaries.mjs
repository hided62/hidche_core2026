import fs from 'node:fs/promises';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const zones = [
    { name: 'common', root: 'packages/common/src', allowed: [] },
    { name: 'logic', root: 'packages/logic/src', allowed: ['@sammo-ts/common'] },
    { name: 'infra', root: 'packages/infra/src', allowed: ['@sammo-ts/logic'] },
    {
        name: 'game-engine',
        root: 'app/game-engine/src',
        allowed: ['@sammo-ts/common', '@sammo-ts/infra', '@sammo-ts/logic'],
    },
    {
        name: 'game-api',
        root: 'app/game-api/src',
        allowed: ['@sammo-ts/common', '@sammo-ts/infra', '@sammo-ts/logic', '@sammo-ts/game-engine'],
    },
    {
        name: 'gateway-api',
        root: 'app/gateway-api/src',
        allowed: ['@sammo-ts/common', '@sammo-ts/infra', '@sammo-ts/logic', '@sammo-ts/game-engine'],
    },
    {
        name: 'release-controller',
        root: 'app/release-controller/src',
        allowed: ['@sammo-ts/gateway-api', '@sammo-ts/infra'],
    },
    {
        name: 'game-frontend',
        root: 'app/game-frontend/src',
        allowed: ['@sammo-ts/common', '@sammo-ts/logic', '@sammo-ts/game-api', '@sammo-ts/gateway-api'],
        frontend: true,
    },
    {
        name: 'gateway-frontend',
        root: 'app/gateway-frontend/src',
        allowed: ['@sammo-ts/common', '@sammo-ts/game-api', '@sammo-ts/gateway-api'],
        frontend: true,
    },
];

const persistenceModules = new Set([
    '@sammo-ts/infra',
    '@prisma/client',
    'pg',
    'redis',
    'fs',
    'fs/promises',
    'http',
    'https',
    'net',
    'child_process',
    'node:fs',
    'node:fs/promises',
    'node:http',
    'node:https',
    'node:net',
    'node:dgram',
    'node:dns',
    'node:tls',
    'node:child_process',
    'node:worker_threads',
]);

const backendPackages = new Set(['@sammo-ts/game-api', '@sammo-ts/gateway-api']);
const nodeBuiltins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

const isPersistenceModule = (specifier) =>
    persistenceModules.has(specifier) ||
    ['@sammo-ts/infra/', '@prisma/client/', 'pg/', 'redis/'].some((prefix) => specifier.startsWith(prefix));

const listSources = async (root) => {
    const result = [];
    const visit = async (directory) => {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                await visit(absolute);
            } else if (/\.(?:ts|tsx|vue)$/.test(entry.name)) {
                result.push(absolute);
            }
        }
    };
    await visit(root);
    return result.sort();
};

const internalPackageName = (specifier) => {
    const match = /^(@sammo-ts\/[^/]+)/.exec(specifier);
    return match?.[1] ?? null;
};

export const extractImports = (source) => {
    const imports = [];
    const fromPattern = /\b(?:import|export)\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
    const sideEffectPattern = /\bimport\s+['"]([^'"]+)['"]/g;
    const dynamicPattern = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
    let match;
    while ((match = fromPattern.exec(source))) {
        imports.push({ specifier: match[3], typeOnly: Boolean(match[1]), clause: match[2] });
    }
    while ((match = sideEffectPattern.exec(source))) {
        imports.push({ specifier: match[1], typeOnly: false, clause: '' });
    }
    while ((match = dynamicPattern.exec(source))) {
        imports.push({ specifier: match[1], typeOnly: false, clause: '' });
    }
    return imports;
};

export const checkSource = ({ source, relativePath, zone }) => {
    const violations = [];
    for (const imported of extractImports(source)) {
        const packageName = internalPackageName(imported.specifier);
        if (packageName && packageName !== `@sammo-ts/${zone.name}` && !zone.allowed.includes(packageName)) {
            violations.push(`${relativePath}: ${zone.name} may not depend on ${packageName}`);
        }
        if ((zone.name === 'common' || zone.name === 'logic') && isPersistenceModule(imported.specifier)) {
            violations.push(
                `${relativePath}: ${zone.name} must access I/O through an injected port (${imported.specifier})`
            );
        }
        if (zone.frontend && nodeBuiltins.has(imported.specifier)) {
            violations.push(`${relativePath}: frontend production code may not import ${imported.specifier}`);
        }
        if (zone.frontend && packageName && backendPackages.has(packageName) && !imported.typeOnly) {
            violations.push(`${relativePath}: frontend may reference ${packageName} only through import type`);
        }
        if (
            (zone.name === 'game-api' || zone.name === 'gateway-api') &&
            imported.specifier === '@sammo-ts/game-engine'
        ) {
            violations.push(
                `${relativePath}: import a side-effect-free @sammo-ts/game-engine subpath instead of its process entrypoint`
            );
        }
        if (imported.specifier === '@sammo-ts/infra' && /\b(?:LogCategory|LogScope)\b/.test(imported.clause)) {
            violations.push(`${relativePath}: LogCategory and LogScope are owned by @sammo-ts/logic`);
        }
    }
    if ((zone.name === 'common' || zone.name === 'logic') && /\bprocess\.(?:env|stdout|stderr)\b/.test(source)) {
        violations.push(`${relativePath}: ${zone.name} runtime diagnostics must use an injected port`);
    }
    if ((zone.name === 'common' || zone.name === 'logic') && /\bfetch\s*\(/.test(source)) {
        violations.push(`${relativePath}: ${zone.name} network access must use an injected port`);
    }
    return violations;
};

export const checkWorkspace = async () => {
    const violations = [];
    for (const zone of zones) {
        const absoluteRoot = path.join(workspaceRoot, zone.root);
        const packageRoot = path.dirname(absoluteRoot);
        const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
        const importedPackages = new Map();
        for (const filename of await listSources(absoluteRoot)) {
            const source = await fs.readFile(filename, 'utf8');
            const relativePath = path.relative(workspaceRoot, filename);
            violations.push(...checkSource({ source, relativePath, zone }));
            for (const imported of extractImports(source)) {
                const packageName = internalPackageName(imported.specifier);
                if (!packageName || packageName === manifest.name) {
                    continue;
                }
                const usage = importedPackages.get(packageName) ?? { runtime: false, typeOnly: false };
                usage.typeOnly ||= imported.typeOnly;
                usage.runtime ||= !imported.typeOnly;
                importedPackages.set(packageName, usage);
            }
        }
        for (const [packageName, usage] of importedPackages) {
            const inDependencies = Object.hasOwn(manifest.dependencies ?? {}, packageName);
            const inDevDependencies = Object.hasOwn(manifest.devDependencies ?? {}, packageName);
            if (!inDependencies && !inDevDependencies) {
                violations.push(`${path.relative(workspaceRoot, packageRoot)}/package.json: missing ${packageName}`);
            }
            if (usage.runtime && !inDependencies) {
                violations.push(
                    `${path.relative(workspaceRoot, packageRoot)}/package.json: runtime dependency ${packageName} must be in dependencies`
                );
            }
            if (zone.frontend && backendPackages.has(packageName) && inDependencies) {
                violations.push(
                    `${path.relative(workspaceRoot, packageRoot)}/package.json: type-only backend ${packageName} belongs in devDependencies`
                );
            }
        }
    }
    return violations;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const violations = await checkWorkspace();
    if (violations.length > 0) {
        console.error(`Package boundary check failed (${violations.length})`);
        for (const violation of violations) {
            console.error(`- ${violation}`);
        }
        process.exitCode = 1;
    } else {
        console.info('Package boundary check passed.');
    }
}
