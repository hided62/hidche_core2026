#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scenarioRoot = path.join(repositoryRoot, 'resources', 'scenario');
const catalogPath = path.join(repositoryRoot, 'resources', 'general-icons.json');
const canonicalDirectory = '장수';

const args = process.argv.slice(2);
const write = args.includes('--write');
const imageRootIndex = args.indexOf('--image-root');
if (imageRootIndex < 0 || !args[imageRootIndex + 1]) {
    throw new Error('Usage: node tools/manage-general-icons.mjs --image-root <image-repository> [--write]');
}
const imageRoot = path.resolve(args[imageRootIndex + 1]);
const iconsRoot = path.join(imageRoot, 'icons');

const compareText = (left, right) => left.localeCompare(right, 'ko');
const toPosix = (value) => value.split(path.sep).join('/');

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, 'utf8'));

const exists = async (filePath) => {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
};

const listFiles = async (root) => {
    const result = [];
    const visit = async (directory) => {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                await visit(entryPath);
            } else if (entry.isFile()) {
                result.push(toPosix(path.relative(iconsRoot, entryPath)));
            }
        }
    };
    await visit(root);
    return result.sort(compareText);
};

const scenarioFiles = (await fs.readdir(scenarioRoot))
    .filter((fileName) => /^scenario_\d+\.json$/.test(fileName))
    .sort(compareText);
const scenarios = await Promise.all(
    scenarioFiles.map(async (fileName) => {
        const filePath = path.join(scenarioRoot, fileName);
        const source = await fs.readFile(filePath, 'utf8');
        return {
            fileName,
            filePath,
            source,
            data: JSON.parse(source),
        };
    })
);

const inventory = await listFiles(iconsRoot);
const inventorySet = new Set(inventory);
const filesByDirectoryAndStem = new Map();
const filesByStem = new Map();
for (const relativePath of inventory) {
    const parsed = path.posix.parse(relativePath);
    const directory = parsed.dir || '.';
    const directoryKey = `${directory}\0${parsed.name.normalize('NFC')}`;
    filesByDirectoryAndStem.set(directoryKey, relativePath);
    const stem = parsed.name.normalize('NFC');
    const values = filesByStem.get(stem) ?? [];
    values.push(relativePath);
    filesByStem.set(stem, values);
}

const existingCatalog = (await exists(catalogPath))
    ? await readJson(catalogPath)
    : { schemaVersion: 1, canonicalDirectory, icons: [], unresolved: [] };
const entriesByName = new Map(existingCatalog.icons.map((entry) => [entry.name, entry]));

const numericSourcesByName = new Map();
const namesByNumericId = new Map();
for (const scenario of scenarios) {
    for (const collectionName of ['general', 'general_ex', 'general_neutral']) {
        for (const row of scenario.data[collectionName] ?? []) {
            const [name, picture] = [row[1], row[2]];
            if (typeof name !== 'string' || typeof picture !== 'number' || picture < 0) {
                continue;
            }
            const normalizedName = name.normalize('NFC');
            const ids = numericSourcesByName.get(normalizedName) ?? new Set();
            ids.add(picture);
            numericSourcesByName.set(normalizedName, ids);
            const names = namesByNumericId.get(picture) ?? new Set();
            names.add(normalizedName);
            namesByNumericId.set(picture, names);
        }
    }
}

const ambiguousNames = [...numericSourcesByName]
    .filter(([, ids]) => ids.size > 1)
    .map(([name, ids]) => ({ name, legacyPictureIds: [...ids].sort((left, right) => left - right) }));
if (ambiguousNames.length > 0) {
    throw new Error(`One general name maps to multiple numeric icons: ${JSON.stringify(ambiguousNames)}`);
}

const unresolvedByName = new Map(
    (existingCatalog.unresolved ?? []).map((entry) => [entry.name, entry])
);
for (const [name, ids] of [...numericSourcesByName].sort(([left], [right]) => compareText(left, right))) {
    if (entriesByName.has(name)) {
        continue;
    }
    const legacyPictureIds = [...ids].sort((left, right) => left - right);
    const numericSource = `icons/${legacyPictureIds[0]}.jpg`;
    let source = numericSource;
    if (!inventorySet.has(numericSource.slice('icons/'.length))) {
        const namedCandidates = (filesByStem.get(name) ?? []).filter(
            (candidate) => !candidate.startsWith(`${canonicalDirectory}/`)
        );
        if (namedCandidates.length !== 1) {
            unresolvedByName.set(name, {
                name,
                legacyPictureIds,
                reason:
                    namedCandidates.length === 0
                        ? 'missing numeric and unique named source'
                        : 'multiple named source candidates',
                candidates: namedCandidates,
            });
            continue;
        }
        source = `icons/${namedCandidates[0]}`;
    }
    const extension = path.posix.extname(source).toLowerCase();
    const fileName = `${name}${extension}`;
    entriesByName.set(name, {
        name,
        path: `${canonicalDirectory}/${fileName}`,
        legacyPictureIds,
        source,
    });
}

const catalog = {
    schemaVersion: 1,
    canonicalDirectory,
    icons: [...entriesByName.values()].sort((left, right) => compareText(left.name, right.name)),
    unresolved: [...unresolvedByName.values()].sort((left, right) => compareText(left.name, right.name)),
};
const catalogByName = new Map(catalog.icons.map((entry) => [entry.name, entry]));
const catalogByNumericId = new Map();
for (const entry of catalog.icons) {
    for (const numericId of entry.legacyPictureIds) {
        const values = catalogByNumericId.get(numericId) ?? [];
        values.push(entry);
        catalogByNumericId.set(numericId, values);
    }
}

const stats = {
    scenarios: scenarios.length,
    rows: 0,
    changedRows: 0,
    themedMatches: 0,
    canonicalMatches: 0,
    unresolvedRows: 0,
};

const resolvePicture = (name, picture, iconDirectory) => {
    const normalizedName = name.normalize('NFC');
    if (typeof picture === 'number') {
        if (picture < 0) {
            return 'default.jpg';
        }
        const candidates = catalogByNumericId.get(picture) ?? [];
        const exact = candidates.find((entry) => entry.name === normalizedName);
        const selected = exact ?? (candidates.length === 1 ? candidates[0] : undefined);
        if (selected) {
            stats.canonicalMatches += 1;
            return selected.path;
        }
        stats.unresolvedRows += 1;
        return 'default.jpg';
    }
    if (typeof picture === 'string' && picture.length > 0) {
        if (picture.includes('/')) {
            return picture;
        }
        if (iconDirectory !== '.' && inventorySet.has(`${iconDirectory}/${picture}`)) {
            return `${iconDirectory}/${picture}`;
        }
        return picture;
    }

    if (iconDirectory !== '.') {
        const themed = filesByDirectoryAndStem.get(`${iconDirectory}\0${normalizedName}`);
        if (themed) {
            stats.themedMatches += 1;
            return themed;
        }
    }
    const canonical = catalogByName.get(normalizedName);
    if (canonical) {
        stats.canonicalMatches += 1;
        return canonical.path;
    }
    const rootNamed = filesByDirectoryAndStem.get(`.\0${normalizedName}`);
    if (rootNamed) {
        stats.themedMatches += 1;
        return rootNamed;
    }
    stats.unresolvedRows += 1;
    return null;
};

const renderRow = (row) => `[${row.map((value) => JSON.stringify(value)).join(', ')}]`;

const rewriteScenario = (scenario) => {
    const iconDirectory = typeof scenario.data.iconPath === 'string' ? scenario.data.iconPath : '.';
    const expectedCounts = new Map(
        ['general', 'general_ex', 'general_neutral'].map((collectionName) => [
            collectionName,
            (scenario.data[collectionName] ?? []).length,
        ])
    );
    const visitedCounts = new Map([...expectedCounts.keys()].map((collectionName) => [collectionName, 0]));
    let activeCollection = null;
    const output = scenario.source.split('\n').map((line) => {
        const collectionMatch = line.match(/^ {4}"(general|general_ex|general_neutral)": \[$/);
        if (collectionMatch) {
            activeCollection = collectionMatch[1];
            return line;
        }
        if (activeCollection === null) {
            return line;
        }
        if (/^ {4}\](?:,)?$/.test(line)) {
            activeCollection = null;
            return line;
        }
        if (line.trim() === '') {
            return line;
        }
        const rowMatch = line.match(/^( {8})(\[.*\])(,?)$/);
        if (!rowMatch) {
            throw new Error(`${scenario.fileName}: unsupported multiline ${activeCollection} row: ${line}`);
        }
        const row = JSON.parse(rowMatch[2]);
        if (!Array.isArray(row) || typeof row[1] !== 'string') {
            throw new Error(`${scenario.fileName}: invalid ${activeCollection} row: ${line}`);
        }
        stats.rows += 1;
        visitedCounts.set(activeCollection, (visitedCounts.get(activeCollection) ?? 0) + 1);
        const resolved = resolvePicture(row[1], row[2], iconDirectory);
        if (row[2] !== resolved) {
            row[2] = resolved;
            stats.changedRows += 1;
            return `${rowMatch[1]}${renderRow(row)}${rowMatch[3]}`;
        }
        return line;
    });
    for (const [collectionName, expected] of expectedCounts) {
        const visited = visitedCounts.get(collectionName);
        if (visited !== expected) {
            throw new Error(
                `${scenario.fileName}: visited ${String(visited)} ${collectionName} rows, expected ${String(expected)}`
            );
        }
    }
    return output.join('\n');
};

for (const scenario of scenarios) {
    scenario.output = rewriteScenario(scenario);
}

const catalogText = `${JSON.stringify(catalog, null, 4)}\n`;
let drift = !(await exists(catalogPath)) || (await fs.readFile(catalogPath, 'utf8')) !== catalogText;
for (const scenario of scenarios) {
    if (scenario.source !== scenario.output) {
        drift = true;
    }
}

for (const entry of catalog.icons) {
    const sourcePath = path.join(imageRoot, entry.source);
    const destinationPath = path.join(iconsRoot, entry.path);
    if (!(await exists(sourcePath))) {
        throw new Error(`Catalog source does not exist: ${entry.source}`);
    }
    if (!(await exists(destinationPath))) {
        drift = true;
        if (write) {
            await fs.mkdir(path.dirname(destinationPath), { recursive: true });
            await fs.copyFile(sourcePath, destinationPath);
        }
    } else {
        const [sourceBytes, destinationBytes] = await Promise.all([
            fs.readFile(sourcePath),
            fs.readFile(destinationPath),
        ]);
        if (!sourceBytes.equals(destinationBytes)) {
            throw new Error(`Canonical icon differs from source: icons/${entry.path}`);
        }
    }
}

if (write) {
    await fs.writeFile(catalogPath, catalogText);
    await Promise.all(scenarios.map((scenario) => fs.writeFile(scenario.filePath, scenario.output)));
} else if (drift) {
    throw new Error('General icon catalog, aliases, or scenario paths are out of date. Re-run with --write.');
}

console.log(
    JSON.stringify(
        {
            mode: write ? 'write' : 'check',
            canonicalIcons: catalog.icons.length,
            unresolvedCatalogEntries: catalog.unresolved.length,
            sharedNumericIds: [...catalogByNumericId.values()].filter((entries) => entries.length > 1).length,
            ...stats,
        },
        null,
        2
    )
);
