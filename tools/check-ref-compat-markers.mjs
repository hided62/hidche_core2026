import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const sourceRoots = ['app', 'packages'];
const inventoryPath = path.join(root, 'docs', 'ref-compatibility-shims.md');
const beginPattern = /REF-COMPAT:BEGIN ([a-z0-9]+(?:-[a-z0-9]+)*)/g;
const endPattern = /REF-COMPAT:END ([a-z0-9]+(?:-[a-z0-9]+)*)/g;
const inventoryPattern = /<!-- REF-COMPAT-ID: ([a-z0-9]+(?:-[a-z0-9]+)*) -->/g;
const sourceExtensions = new Set(['.ts', '.tsx', '.vue', '.js', '.mjs', '.cjs']);

const collectFiles = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await collectFiles(absolute)));
        } else if (sourceExtensions.has(path.extname(entry.name))) {
            files.push(absolute);
        }
    }
    return files;
};

const fail = (message) => {
    process.stderr.write(`ref compatibility marker check failed: ${message}\n`);
    process.exitCode = 1;
};

const regionsById = new Map();
for (const sourceRoot of sourceRoots) {
    for (const file of await collectFiles(path.join(root, sourceRoot))) {
        const relative = path.relative(root, file);
        const lines = (await readFile(file, 'utf8')).split(/\r?\n/);
        let openRegion = null;
        for (let index = 0; index < lines.length; index += 1) {
            const lineNumber = index + 1;
            const begins = [...lines[index].matchAll(beginPattern)].map((match) => match[1]);
            const ends = [...lines[index].matchAll(endPattern)].map((match) => match[1]);
            if (begins.length + ends.length > 1) {
                fail(`${relative}:${lineNumber} contains more than one marker`);
                continue;
            }
            if (begins.length === 1) {
                if (openRegion) {
                    fail(`${relative}:${lineNumber} nests ${begins[0]} inside ${openRegion.id}`);
                } else {
                    openRegion = { id: begins[0], line: lineNumber };
                }
            }
            if (ends.length === 1) {
                if (!openRegion) {
                    fail(`${relative}:${lineNumber} closes ${ends[0]} without a BEGIN marker`);
                } else if (openRegion.id !== ends[0]) {
                    fail(`${relative}:${lineNumber} closes ${ends[0]} but ${openRegion.id} is open`);
                } else {
                    const regions = regionsById.get(openRegion.id) ?? [];
                    regions.push(`${relative}:${openRegion.line}-${lineNumber}`);
                    regionsById.set(openRegion.id, regions);
                    openRegion = null;
                }
            }
        }
        if (openRegion) {
            fail(`${relative}:${openRegion.line} leaves ${openRegion.id} open`);
        }
    }
}

const inventory = await readFile(inventoryPath, 'utf8');
const inventoryIds = [...inventory.matchAll(inventoryPattern)].map((match) => match[1]);
const uniqueInventoryIds = new Set(inventoryIds);
if (uniqueInventoryIds.size !== inventoryIds.length) {
    fail('the inventory contains a duplicate REF-COMPAT-ID');
}

for (const id of regionsById.keys()) {
    if (!uniqueInventoryIds.has(id)) {
        fail(`${id} is marked in source but missing from docs/ref-compatibility-shims.md`);
    }
}
for (const id of uniqueInventoryIds) {
    if (!regionsById.has(id)) {
        fail(`${id} is documented but has no source region`);
    }
}

if (process.exitCode) {
    process.exit(process.exitCode);
}

const regionCount = [...regionsById.values()].reduce((sum, regions) => sum + regions.length, 0);
process.stdout.write(
    `ref compatibility markers: ${regionsById.size} ids, ${regionCount} source regions, inventory synchronized\n`
);
