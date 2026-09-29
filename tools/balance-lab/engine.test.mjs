import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { processBattleSimJob, parseUnitSetDefinition } from '../../packages/logic/dist/index.js';
import { makePayload, observe } from './design.mjs';

const units = parseUnitSetDefinition(
    JSON.parse(await readFile(new URL('../../resources/unitset/unitset_che.json', import.meta.url), 'utf8'))
);
const cell = { unit: 1100, opponent: 1200, build: 'martial', role: 'attack', mode: 'field' };
function run(payload, role = 'attack') {
    let observation;
    processBattleSimJob(payload, {
        onBattleResolved: (outcome) => {
            observation = observe(outcome, payload, role);
        },
    });
    assert.ok(observation);
    assert.ok(Object.values(observation).every((value) => value === null || Number.isFinite(value)));
    return observation;
}
test('actual engine is deterministic and leaves the input fixture immutable', () => {
    const payload = makePayload(units, cell, 'balance-test');
    const saved = structuredClone(payload);
    assert.deepEqual(run(payload), run(payload));
    assert.deepEqual(payload, saved);
});
test('neutral nation control is exactly equal, not just statistically similar', () => {
    const paired = { ...cell, nationTrait: 'che_중립' };
    assert.deepEqual(run(makePayload(units, paired, 's')), run(makePayload(units, paired, 's', false)));
});
test('same-unit mirror results reverse exchange and retain zero wall damage', () => {
    const mirror = { ...cell, opponent: 1100 };
    const attack = run(makePayload(units, mirror, 's'));
    const defend = run(makePayload(units, { ...mirror, role: 'defend' }, 's'), 'defend');
    assert.ok(Math.abs(attack.exchange + defend.exchange) < 1e-12);
    assert.equal(attack.wallDamage, 0);
});
test('real siege item is equipped and changes wall damage in the production action stack', () => {
    const siege = { ...cell, unit: 1501, build: 'command', mode: 'siege', generalPatch: { item: 'che_공성_묵자' } };
    const control = run(makePayload(units, { ...siege, wall: 5000 }, 'balance-test', false));
    const treatment = run(makePayload(units, { ...siege, wall: 5000 }, 'balance-test'));
    assert.equal(treatment.exchange, null);
    assert.ok(treatment.wallDamage > control.wallDamage);
});
