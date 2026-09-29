import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BUILDS, makePayload, buildPlan, summarize, observe } from './design.mjs';

const unitSet = JSON.parse(
    await readFile(new URL('../../resources/unitset/unitset_che.json', import.meta.url), 'utf8')
);
const cell = {
    unit: 1100,
    opponent: 1200,
    build: 'martial',
    role: 'attack',
    mode: 'field',
    generalPatch: { weapon: 'test-item' },
};

test('allocation preserves total stat budget and caps troops by leadership', () => {
    for (const [build, stats] of Object.entries(BUILDS)) {
        assert.equal(
            Object.values(stats).reduce((a, b) => a + b),
            210
        );
        const payload = makePayload(unitSet, { ...cell, build }, 's');
        assert.ok(payload.attackerGeneral.crew <= stats.leadership * 100);
    }
});
test('treatment changes only the subject and paired control removes it in both roles', () => {
    for (const role of ['attack', 'defend']) {
        const treatment = makePayload(unitSet, { ...cell, role, nationTrait: 'che_병가' }, 's');
        const control = makePayload(unitSet, { ...cell, role, nationTrait: 'che_병가' }, 's', false);
        const own = role === 'attack' ? treatment.attackerGeneral : treatment.defenderGenerals[0];
        const enemy = role === 'attack' ? treatment.defenderGenerals[0] : treatment.attackerGeneral;
        assert.equal(own.crewtype, cell.unit);
        assert.equal(enemy.crewtype, cell.opponent);
        assert.equal(own.weapon, 'test-item');
        assert.equal(enemy.weapon, null);
        own.weapon = null;
        treatment[role === 'attack' ? 'attackerNation' : 'defenderNation'].type = 'che_중립';
        assert.deepEqual(treatment, control);
    }
});
test('field and siege are separate and economic budget respects expensive units', () => {
    assert.equal(makePayload(unitSet, cell, 's').defenderCity.wall, 0);
    const siege = makePayload(unitSet, { ...cell, mode: 'siege' }, 's');
    assert.equal(siege.defenderGenerals.length, 0);
    assert.equal(siege.defenderCity.wall, 1000);
    const expensive = makePayload(unitSet, { ...cell, unit: 1503, budget: 'equal-gold' }, 's');
    assert.ok(expensive.attackerGeneral.crew < 7000);
    assert.throws(() => makePayload(unitSet, { ...cell, mode: 'siege', role: 'defend' }, 's'));
});
test('observer excludes wall damage from field exchange and preserves unknown siege exchange', () => {
    const payload = makePayload(unitSet, cell, 's');
    const outcome = {
        attacker: { crew: 6000, rice: 99900, injury: 0 },
        defenders: [{ crew: 5000 }],
        conquered: false,
        reports: [
            { id: 1, type: 'general', dead: 1000, killed: 9000 },
            { id: 2, type: 'general', dead: 2000 },
            { id: null, type: 'city', dead: 7000 },
        ],
    };
    assert.equal(observe(outcome, payload, 'attack').fieldKills, 2000);
    assert.equal(observe(outcome, payload, 'attack').exchange, 1000 / 7000);
    const siege = makePayload(unitSet, { ...cell, mode: 'siege' }, 's');
    assert.equal(observe({ ...outcome, defenders: [] }, siege, 'attack').exchange, null);
});
test('statistics expose n, interval and tails; invalid samples fail closed', () => {
    assert.deepEqual(summarize([2, 2]).ci95, [2, 2]);
    assert.equal(summarize([1, 2, 3]).mean, 2);
    assert.equal(summarize([1]).ci95, null);
    assert.throws(() => summarize([]));
    assert.throws(() => summarize([NaN]));
});
test('design covers every registered unit, both budgets, four builds, roles and siege', () => {
    const catalog = { units: unitSet.crewTypes.filter((unit) => unit.armType > 0) };
    const plan = buildPlan(catalog, 'units');
    assert.equal(plan.length, catalog.units.length * 4 * 2 * 12);
    assert.equal(new Set(plan.map((cell) => cell.id)).size, plan.length);
    assert.throws(() => buildPlan(catalog, 'no-such-suite'));
});

test('native family and tier comparisons use matched total stats and directly compare tier-three units', () => {
    const catalog = { units: unitSet.crewTypes.filter((unit) => unit.armType > 0) };
    const families = buildPlan(catalog, 'families');
    assert.equal(families.length, 5 * 5 * 3 * 2);
    const pair = families.find((row) => row.unit === 1400 && row.opponent === 1100 && row.role === 'attack');
    const payload = makePayload(unitSet, pair, 's');
    assert.equal(payload.attackerGeneral.intel, 90);
    assert.equal(payload.defenderGenerals[0].strength, 90);
    const capacity = makePayload(unitSet, { ...pair, unit: 1500, build: 'command', budget: 'capacity' }, 's');
    assert.equal(capacity.attackerGeneral.crew, 15000);
    const tiers = buildPlan(catalog, 'tiers');
    assert.ok(tiers.some((row) => row.unit === 1502 && row.opponent === 1503));
    assert.ok(tiers.every((row) => ![1100, 1306].includes(row.unit)));
});

test('depleted line encounters preserve defender ownership and vary only subject readiness', () => {
    const payload = makePayload(unitSet, { ...cell, condition: 'depleted', mode: 'line' }, 's');
    assert.equal(payload.attackerGeneral.crew, 3500);
    assert.equal(payload.attackerGeneral.train, 70);
    assert.deepEqual(
        payload.defenderGenerals.map((row) => row.no),
        [2, 3, 4]
    );
    assert.ok(payload.defenderGenerals.every((row) => row.nation === 2 && row.city === 2 && row.train === 100));
});
