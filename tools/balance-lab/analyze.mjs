import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = path.resolve(root, process.argv[2] ?? 'test-results/balance-lab/units');
const read = async (file) => JSON.parse(await readFile(path.join(directory, file), 'utf8'));
const manifest = await read('manifest.json');
if (!manifest.completed) throw new Error('Cannot analyze an incomplete experiment');
const rows = await read('summary.json');
const catalog = await read('catalog.json');
const names = new Map([
    ...catalog.units.map((entry) => [String(entry.id), entry.name]),
    ...[...catalog.items, ...catalog.war, ...catalog.nations].map((entry) => [entry.key, entry.name]),
]);
const name = (key) => names.get(key) ?? key;
const mean = (numbers) => numbers.reduce((sum, x) => sum + x, 0) / numbers.length;
const percent = (number) => (number * 100).toFixed(1);
const lines = [
    `# ${manifest.suite}: ${manifest.design}`,
    '',
    `- Source: ${manifest.commit}, SHA-256 ${manifest.sourceHash}`,
    `- ${manifest.cells} cells × ${manifest.samples} seeds; ${manifest.battles} battles.`,
    '- Synthetic scenario screen, not live win rate. Cell intervals are descriptive; no multiplicity correction.',
    '- Exchange = enemy loss fraction minus own loss fraction; numbers below are percentage points.',
    '- Opponents and attack/defence cells have equal weight. These are designed scenario means, not independent samples.',
    '',
];
const groups = new Map();
for (const row of rows.filter((entry) => entry.mode === 'field')) {
    const key = JSON.stringify([
        row.key,
        row.build,
        row.unit,
        row.budget ?? 'equal-crew',
        row.baseline,
        row.condition,
        row.wallet,
        row.quality,
    ]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
}
const ranking = [...groups.values()]
    .map((group) => {
        const paired = Boolean(group[0].delta);
        const scores = group.map((row) => (paired ? row.delta : row.treatment).exchange.mean);
        return {
            key: group[0].key,
            build: group[0].build,
            unit: group[0].unit,
            baseline: group[0].baseline ?? 'empty',
            condition: group[0].condition ?? 'ready',
            wallet: group[0].wallet ?? null,
            quality: group[0].quality ?? null,
            budget: group[0].budget ?? 'equal-crew',
            effect: paired ? 'vs-specified-control' : 'absolute-exchange',
            cells: group.length,
            mean: mean(scores),
            worstCell: Math.min(...scores),
            bestCell: Math.max(...scores),
            aboveScreen: scores.filter((score) => score >= 0.1).length / scores.length,
            belowScreen: scores.filter((score) => score <= -0.1).length / scores.length,
        };
    })
    .sort((a, b) => b.mean - a.mean);
lines.push(
    '## Field screen',
    '',
    '| Candidate | Build | Budget | Mean | Worst cell | Best cell | Cells >=10 pp |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: |'
);
for (const row of ranking)
    lines.push(
        `| ${name(row.key)} | ${row.build}/${name(String(row.unit))} | ${row.budget}/${row.baseline}/${row.condition}${row.wallet ? '/' + row.wallet + '/' + row.quality : ''} | ${percent(row.mean)} | ${percent(row.worstCell)} | ${percent(row.bestCell)} | ${percent(row.aboveScreen)}% |`
    );
if (['units', 'families', 'tiers'].includes(manifest.suite)) {
    lines.push('', '## Matchup matrices (attack/defence mean)', '');
    const strata = [...new Set(rows.filter((row) => row.mode === 'field').map((row) => `${row.build}/${row.budget}`))];
    for (const stratum of strata) {
        const subset = rows.filter((row) => row.mode === 'field' && `${row.build}/${row.budget}` === stratum);
        const candidates = [...new Set(subset.map((row) => row.key))];
        const opponents = [...new Set(subset.map((row) => row.opponent))];
        lines.push(
            `### ${stratum}`,
            '',
            `| Candidate | ${opponents.map((id) => name(String(id))).join(' | ')} |`,
            `| --- | ${opponents.map(() => '---:').join(' | ')} |`
        );
        for (const candidate of candidates)
            lines.push(
                `| ${name(candidate)} | ${opponents.map((opponent) => percent(mean(subset.filter((row) => row.key === candidate && row.opponent === opponent).map((row) => row.treatment.exchange.mean)))).join(' | ')} |`
            );
        lines.push('');
    }
}
lines.push(
    '',
    '## Siege (do not combine with field exchange)',
    '',
    '| Candidate | Build | Budget / city defence | Wall damage | Change vs control | Rice | Own dead |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: |'
);
for (const row of rows
    .filter((entry) => entry.mode === 'siege')
    .sort((a, b) => b.treatment.wallDamage.mean - a.treatment.wallDamage.mean)) {
    lines.push(
        `| ${name(row.key)} | ${row.build}${row.condition ? '/' + row.condition : ''} | ${row.budget ?? 'equal-crew'}/${row.wall ?? 1000} | ${row.treatment.wallDamage.mean.toFixed(0)} | ${row.delta ? row.delta.wallDamage.mean.toFixed(0) : 'n/a'} | ${row.treatment.rice.mean.toFixed(0)} | ${row.treatment.dead.mean.toFixed(0)} |`
    );
}
if (rows.some((row) => row.synergy)) {
    lines.push(
        '',
        '## Factorial interactions',
        '',
        'Synergy = both - trait alone - item alone + neither.',
        '',
        '| Pair | Mode | Condition | Exchange delta | Exchange synergy | Wall delta | Wall synergy |',
        '| --- | --- | --- | ---: | ---: | ---: | ---: |'
    );
    for (const row of rows.filter((row) => row.synergy))
        lines.push(
            `| ${row.key} | ${row.mode} | ${row.condition}/city-${row.wall ?? 1000} | ${row.delta.exchange ? percent(row.delta.exchange.mean) : 'n/a'} | ${row.synergy.exchange ? percent(row.synergy.exchange.mean) : 'n/a'} | ${row.delta.wallDamage.mean.toFixed(0)} | ${row.synergy.wallDamage.mean.toFixed(0)} |`
        );
}
if (['recruit', 'attrition'].includes(manifest.suite)) {
    lines.push(
        '',
        '## Recruitment (actual production resolver)',
        '',
        '| Candidate | Unit | Wallet / quality | Subject troops | Control troops | Gold spent | Population drawn | Initial train | Exchange delta |',
        '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |'
    );
    for (const group of groups.values()) {
        const row = group[0];
        lines.push(
            `| ${name(row.key)} | ${name(String(row.unit))} | ${row.wallet}/${row.quality}/${row.condition ?? 'ready'} | ${row.treatment.recruit_crew.mean} | ${row.control.recruit_crew.mean} | ${row.treatment.recruit_gold.mean} | ${row.treatment.recruit_population.mean} | ${row.treatment.recruit_train.mean} | ${percent(mean(group.map((row) => row.delta.exchange.mean)))} |`
        );
    }
}
await writeFile(path.join(directory, 'screen.json'), JSON.stringify(ranking, null, 2));
await writeFile(path.join(directory, 'screen.md'), lines.join('\n') + '\n');
console.log(JSON.stringify({ directory, groups: ranking.length, largest: ranking.slice(0, 5) }));
