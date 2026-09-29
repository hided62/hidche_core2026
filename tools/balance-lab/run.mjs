import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DESIGN_VERSION, BUILDS, buildPlan, makePayload, observe, summarize } from './design.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({
    options: {
        suite: { type: 'string', default: 'units' },
        samples: { type: 'string', default: '64' },
        seed: { type: 'string', default: 'balance-2026-09-v1' },
        out: { type: 'string' },
        match: { type: 'string' },
        plan: { type: 'boolean', default: false },
    },
});
const samples = Number(values.samples);
if (!Number.isSafeInteger(samples) || samples < 2 || samples > 10000) throw new Error('--samples must be 2..10000');
if (!['units', 'items', 'traits', 'nations', 'families', 'tiers', 'interactions'].includes(values.suite))
    throw new Error('Unknown suite');
const out = path.resolve(root, values.out ?? `test-results/balance-lab/${values.suite}`);
// Build before importing; a previous branch's dist must never become measurement evidence.
for (const pkg of ['common', 'logic']) {
    execFileSync('pnpm', ['--filter', `@sammo-ts/${pkg}`, 'build'], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
}
const logic = await import('../../packages/logic/dist/index.js');
const unitSet = logic.parseUnitSetDefinition(
    JSON.parse(await readFile(path.join(root, 'resources/unitset/unitset_che.json'), 'utf8'))
);
const allItems = await logic.loadItemModules([...logic.ITEM_KEYS]);
const war = await logic.loadWarTraitModules([...logic.WAR_TRAIT_KEYS]);
const nations = await logic.loadNationTraitModules([...logic.NATION_TRAIT_KEYS]);
const spec = (entry) => ({
    key: entry.key,
    name: entry.name,
    info: entry.info,
    slot: entry.slot,
    unique: entry.unique,
    cost: entry.cost,
    selection: entry.selection,
    hooks: Object.keys(entry).filter(
        (key) => typeof entry[key] === 'function' && !['getName', 'getInfo'].includes(key)
    ),
    events: Object.keys(entry.eventHandlers ?? {}),
});
const catalog = {
    scope: 'CHE unitset + all registered unique modules; scenario acquisition eligibility is NOT asserted',
    units: unitSet.crewTypes.filter((unit) => unit.armType > 0),
    items: allItems.filter((item) => item.unique).map(spec),
    war: war.map(spec),
    nations: nations.map(spec),
};
let cells = buildPlan(catalog, values.suite);
if (values.match)
    cells = cells.filter((cell) =>
        `${cell.key}/${cell.build}/${cell.mode}/${cell.role}/${cell.budget ?? ''}`.includes(values.match)
    );
if (!cells.length) throw new Error('No experiment cells selected');
async function hashTree(directories) {
    const hash = createHash('sha256');
    const walk = async (relative) => {
        for (const entry of (await readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) =>
            a.name.localeCompare(b.name)
        )) {
            const child = path.join(relative, entry.name);
            if (entry.isDirectory()) await walk(child);
            else if (entry.isFile()) hash.update(child).update(await readFile(path.join(root, child)));
        }
    };
    for (const dir of directories) await walk(dir);
    return hash.digest('hex');
}
const sourceHash = await hashTree([
    'packages/common/src',
    'packages/logic/src',
    'resources/unitset',
    'tools/balance-lab',
]);
const manifest = {
    design: DESIGN_VERSION,
    suite: values.suite,
    seed: values.seed,
    samples,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceHash,
    node: process.version,
    builds: BUILDS,
    cells: cells.length,
    battles: cells.reduce((sum, cell) => sum + samples * (cell.factorialPatches ? 4 : cell.paired ? 2 : 1), 0),
    protocol: {
        seedPairing: 'same seed within cell and treatment/control; RNG consumption may diverge',
        inference:
            'per-cell descriptive normal CI; correlated cells and multiple tests prevent global significance claims',
        economics: 'equal-gold uses base crew cost only, capped by leadership; not total lifetime cost',
        outcome: 'fraction enemy troops lost minus fraction own troops lost; siege uses wall damage separately',
        environment: 'synthetic CHE, tech 3000, year 200, no scenario effect; no production data or mutation',
    },
    completed: false,
};
await mkdir(out, { recursive: true });
// Never silently truncate a previous run (including a partially completed run).
const claim = await open(path.join(out, 'manifest.json'), 'wx');
await claim.writeFile(JSON.stringify(manifest, null, 2));
await claim.close();
await writeFile(path.join(out, 'catalog.json'), JSON.stringify(catalog, null, 2));
await writeFile(path.join(out, 'plan.json'), JSON.stringify(cells, null, 2));
if (values.plan) {
    console.log(JSON.stringify({ out, ...manifest }));
    process.exit(0);
}

// Nation coefficients are observed through the actual module hooks. Fail on newly context-dependent
// hooks rather than silently inventing a partial domain context for them.
const noContext = new Proxy(
    {},
    {
        get: (_, key) => {
            throw new Error(`Nation probe needs context.${String(key)}`);
        },
    }
);
const nationProfiles = nations.map((module) => {
    const domestic = {};
    for (const action of ['농업', '상업', '기술', '치안', '민심', '인구', '수비', '성벽', '계략', '징병', '모병']) {
        domestic[action] = Object.fromEntries(
            ['score', 'cost', 'success'].map((kind) => {
                const base = kind === 'success' ? 0.5 : 100;
                return [kind, module.onCalcDomestic?.(noContext, action, kind, base) ?? base];
            })
        );
    }
    return {
        key: module.key,
        domestic,
        income: Object.fromEntries(
            ['gold', 'rice', 'pop'].map((kind) => [kind, module.onCalcNationalIncome?.(noContext, kind, 100) ?? 100])
        ),
        populationLoss: module.onCalcNationalIncome?.(noContext, 'pop', -100) ?? -100,
        strategy: Object.fromEntries(
            ['의병모집', '급습', '수몰'].map((action) => [
                action,
                Object.fromEntries(
                    ['delay', 'globalDelay'].map((kind) => [
                        kind,
                        [12, 24, 36].map((base) => ({
                            base,
                            actual: module.onCalcStrategic?.(noContext, action, kind, base) ?? base,
                        })),
                    ])
                ),
            ])
        ),
    };
});
await writeFile(path.join(out, 'nation-profiles.json'), JSON.stringify(nationProfiles, null, 2));

const raw = await open(path.join(out, 'samples.jsonl'), 'wx');
const summary = [];
const started = Date.now();
try {
    for (const cell of cells) {
        const rows = [];
        for (let index = 0; index < samples; index++) {
            // Omit candidate key and role: common random numbers across candidate and role strata.
            const seed = JSON.stringify([
                values.seed,
                cell.build,
                cell.opponent,
                cell.mode,
                cell.budget ?? 'equal-crew',
                cell.condition ?? 'ready',
                index,
            ]);
            const run = (treatment, patch) => {
                const payload = makePayload(unitSet, patch ? { ...cell, generalPatch: patch } : cell, seed, treatment);
                let result;
                logic.processBattleSimJob(payload, {
                    onBattleResolved: (battle) => {
                        result = observe(battle, payload, cell.role);
                    },
                });
                if (!result) throw new Error('Battle did not execute');
                return result;
            };
            const treatment = run(true);
            const control = cell.paired ? run(false) : null;
            const delta = control
                ? Object.fromEntries(
                      Object.entries(treatment).map(([key, value]) => [
                          key,
                          value === null ? null : value - control[key],
                      ])
                  )
                : null;
            const singles = cell.factorialPatches?.map((patch) => run(true, patch));
            const synergy = singles
                ? Object.fromEntries(
                      Object.entries(treatment).map(([key, value]) => [
                          key,
                          value === null ? null : value - singles[0][key] - singles[1][key] + control[key],
                      ])
                  )
                : null;
            const row = { cell: cell.id, index, seed, treatment, control, delta, singles, synergy };
            rows.push(row);
            await raw.write(JSON.stringify(row) + '\n');
        }
        const aggregate = (field) =>
            Object.fromEntries(
                Object.keys(rows[0][field]).map((metric) => {
                    const values = rows.map((row) => row[field][metric]);
                    return [metric, values[0] === null ? null : summarize(values)];
                })
            );
        summary.push({
            ...cell,
            treatment: aggregate('treatment'),
            control: cell.paired ? aggregate('control') : null,
            delta: cell.paired ? aggregate('delta') : null,
            synergy: cell.factorialPatches ? aggregate('synergy') : null,
        });
        if (summary.length % 25 === 0)
            console.error(
                `${values.suite}: ${summary.length}/${cells.length} cells, ${Math.round((Date.now() - started) / 1000)}s`
            );
    }
} finally {
    await raw.close();
}
const finalHash = await hashTree([
    'packages/common/src',
    'packages/logic/src',
    'resources/unitset',
    'tools/balance-lab',
]);
if (finalHash !== sourceHash) throw new Error('Source changed during run; result is not complete');
await writeFile(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
manifest.completed = true;
manifest.elapsedSeconds = (Date.now() - started) / 1000;
await writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(
    JSON.stringify({ out, cells: cells.length, battles: manifest.battles, elapsedSeconds: manifest.elapsedSeconds })
);
