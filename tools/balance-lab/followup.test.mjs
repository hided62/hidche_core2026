import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as logic from '../../packages/logic/dist/index.js';
import * as common from '../../packages/common/dist/index.js';
import { CommandResolver } from '../../packages/logic/dist/src/actions/turn/general/che_징병.js';
import { CommandResolver as VolunteerResolver } from '../../packages/logic/dist/src/actions/turn/nation/che_의병모집.js';
import { economicTools, lifecycleProfiles, nationPlans, strategyPlans } from './economy.mjs';
import { makePayload, observe } from './design.mjs';
import { buildFollowupPlan } from './followup.mjs';

const unitSet = logic.parseUnitSetDefinition(
    JSON.parse(await readFile(new URL('../../resources/unitset/unitset_che.json', import.meta.url), 'utf8'))
);
const items = await logic.loadItemModules([...logic.ITEM_KEYS]);
const war = await logic.loadWarTraitModules([...logic.WAR_TRAIT_KEYS]);
const nations = await logic.loadNationTraitModules([...logic.NATION_TRAIT_KEYS]);
const economics = economicTools(logic, CommandResolver, items, war, nations);
const cell = { unit: 1100, opponent: 1100, build: 'martial', role: 'attack', mode: 'field' };
const catalog = { items: items.filter((item) => item.unique), war, nations };

test('conditional design schedules every loaded unique and war trait against both regional opponents', () => {
    const plan = buildFollowupPlan(catalog, 'conditional');
    for (const module of [...catalog.items, ...catalog.war]) {
        const rows = plan.filter((row) => row.key === module.key);
        assert.equal(rows.length, 20);
        assert.deepEqual([...new Set(rows.map((row) => row.opponent))].sort(), [1104, 1407]);
    }
});

test('premium control equips the same slot on the subject in both roles', () => {
    const plan = buildFollowupPlan(catalog, 'premium');
    for (const cell of plan) {
        const payload = makePayload(unitSet, cell, 'test', false);
        const subject = cell.role === 'attack' ? payload.attackerGeneral : payload.defenderGenerals[0];
        for (const [slot, key] of Object.entries(cell.controlPatch)) assert.equal(subject[slot], key);
    }
    assert.ok(plan.some((row) => row.baseline === 'che_명마_06_흑색마'));
    assert.ok(plan.some((row) => row.baseline === 'che_훈련_청주'));
});

test('regional effect is inactive on basic troops and changes the real regional battle', () => {
    const run = (opponent, treatment) => {
        const payload = makePayload(
            unitSet,
            { ...cell, opponent, generalPatch: { special2: 'che_척사' } },
            'regional-test',
            treatment
        );
        let result;
        logic.processBattleSimJob(payload, {
            onBattleResolved: (outcome) => {
                result = observe(outcome, payload, 'attack');
            },
        });
        return result;
    };
    assert.deepEqual(run(1100, true), run(1100, false));
    assert.ok(run(1104, true).exchange > run(1104, false).exchange);
});

test('production recruitment caps money and increases capacity/readiness without population for recruiting trait', () => {
    const payload = makePayload(unitSet, cell, 'test');
    const unit = unitSet.crewTypes.find((entry) => entry.id === 1100);
    const base = economics.quote(payload.attackerGeneral, payload.attackerNation, payload.time, unit);
    const trait = economics.quote(
        { ...payload.attackerGeneral, special2: 'che_징병' },
        payload.attackerNation,
        payload.time,
        unit
    );
    assert.equal(base.capacity, 9000);
    assert.equal(trait.capacity, 11200); // Production integer stat truncation, not 11250.
    assert.equal(base.train, 40);
    assert.equal(trait.train, 70);
    assert.equal(base.population, base.crew);
    assert.equal(trait.population, 0);
    assert.equal(trait.crew, 11200);
    const poor = economics.quote(payload.attackerGeneral, payload.attackerNation, payload.time, unit, { gold: 100 });
    assert.ok(poor.gold <= 100 && poor.crew < base.crew);
    const empty = economics.quote(payload.attackerGeneral, payload.attackerNation, payload.time, unit, { gold: 0 });
    assert.equal(empty.crew, 0);
});

test('recruited battle inputs pay quote costs and separate fresh from trained troops', () => {
    const design = {
        ...cell,
        budget: 'recruited',
        wallet: 1500,
        quality: 'fresh',
        generalPatch: { special2: 'che_징병' },
    };
    const payload = makePayload(unitSet, design, 'test');
    const cost = economics.recruit(payload, design);
    assert.equal(payload.attackerGeneral.gold + cost.gold, 1500);
    assert.equal(payload.attackerGeneral.rice + cost.rice, 5000);
    assert.equal(payload.attackerGeneral.crew, cost.crew);
    assert.equal(payload.attackerGeneral.train, 70);
    assert.equal(payload.defenderGenerals[0].train, 40);
});

test('lifecycle probes observe sale resources and healing allies and enemies', () => {
    const payload = makePayload(unitSet, cell, 'test');
    const rows = lifecycleProfiles(
        logic,
        common,
        payload,
        items.filter((item) => ['che_보물_도기', 'che_의술_청낭서'].includes(item.key)),
        'lifecycle-test',
        128
    );
    const sale = rows.find((row) => row.kind === 'sale-bonus' && row.year === 200);
    assert.equal(sale.personalGain, 30000);
    assert.equal(sale.nationGain, 30000);
    const heal = rows.find((row) => row.kind === 'pre-turn-heal');
    assert.equal(heal.self, 1);
    assert.ok(heal.ally > 0 && heal.ally < 1 && heal.enemy > 0 && heal.enemy < 1);
});

test('national planning exposes labour cap and individual strategy cooldown bottleneck', () => {
    const profile = {
        key: 'neutral',
        domestic: Object.fromEntries(
            ['농업', '상업', '기술', '수비', '성벽', '치안', '민심', '인구'].map((action) => [
                action,
                { score: 100, cost: 100 },
            ])
        ),
        income: { gold: 100, rice: 100, pop: 100 },
    };
    const plans = nationPlans([profile]).filter((row) => row.role === 'development');
    assert.deepEqual(
        plans.map((row) => row.turns),
        [6, 12, 12]
    );
    const payload = makePayload(unitSet, cell, 'test');
    const strategy = strategyPlans(VolunteerResolver, payload, nations, items);
    const neutral = strategy.find((row) => row.key === 'che_중립' && row.generals === 10 && !row.equipped);
    const diplomat = strategy.find((row) => row.key === 'che_종횡가' && row.generals === 10 && !row.equipped);
    assert.equal(neutral.delay, 100);
    assert.equal(diplomat.delay, 75);
    assert.equal(diplomat.usesWithResources, 4);
    assert.equal(neutral.usesWithResources, 3);
});

test('attrition starts at the same capacity fraction, preserves full payment, and leaves opponents full', () => {
    const plan = buildFollowupPlan(catalog, 'attrition');
    assert.equal(plan.length, 240);
    for (const role of ['attack', 'defend']) {
        const cell = plan.find(
            (row) =>
                row.key === 'che_명마_12_옥란백용구' &&
                row.unit === 1501 &&
                row.crewFraction === 0.25 &&
                row.role === role
        );
        const payload = makePayload(unitSet, cell, 'attrition-test');
        const report = economics.recruit(payload, cell);
        const subject = role === 'attack' ? payload.attackerGeneral : payload.defenderGenerals[0];
        const opponent = role === 'attack' ? payload.defenderGenerals[0] : payload.attackerGeneral;
        assert.equal(report.crew, 16200);
        assert.equal(subject.crew, 4050);
        assert.equal(report.remainingBeforeBattle, 4050);
        assert.equal(opponent.crew, 9000);
        assert.equal(subject.gold + report.gold, cell.wallet);
        assert.equal(subject.train, 100);
    }
});

test('counter design patches only the opposing trait and suppression is a true no-op without it', () => {
    const plan = buildFollowupPlan(catalog, 'counter');
    assert.equal(plan.length, 120);
    for (const role of ['attack', 'defend']) {
        const cell = plan.find(
            (row) => row.unit === 1400 && row.opponent === 1400 && row.role === role && row.condition === 'che_격노'
        );
        const payload = makePayload(unitSet, cell, 'counter-test');
        const subject = role === 'attack' ? payload.attackerGeneral : payload.defenderGenerals[0];
        const opponent = role === 'attack' ? payload.defenderGenerals[0] : payload.attackerGeneral;
        assert.equal(subject.item, 'che_진압_박혁론');
        assert.equal(subject.special2, null);
        assert.equal(opponent.special2, 'che_격노');
    }
    const control = plan.find(
        (row) =>
            row.unit === 1400 && row.opponent === 1400 && row.role === 'attack' && row.condition === 'no-opponent-trait'
    );
    const outcomes = [true, false].map((treatment) => {
        const payload = makePayload(unitSet, control, 'counter-test', treatment);
        let result;
        logic.processBattleSimJob(payload, {
            onBattleResolved: (outcome) => {
                result = observe(outcome, payload, 'attack');
            },
        });
        return result;
    });
    assert.deepEqual(outcomes[0], outcomes[1]);
});
