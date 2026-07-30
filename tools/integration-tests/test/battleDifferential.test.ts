import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { LiteHashDRBG, RandUtil, type RNG } from '@sammo-ts/common';
import {
    ITEM_KEYS,
    DOMESTIC_TRAIT_KEYS,
    EVENT_DOMESTIC_TRAIT_KEYS,
    NATION_TRAIT_KEYS,
    PERSONALITY_TRAIT_KEYS,
    WAR_TRAIT_KEYS,
    loadDomesticTraitModules,
    loadItemModules,
    loadNationTraitModules,
    loadPersonalityTraitModules,
    loadWarTraitModules,
    type UnitSetDefinition,
    type WarBattleTraceEvent,
    type WarEngineConfig,
} from '@sammo-ts/logic';
import { describe, expect, it } from 'vitest';

import { processBattleSimJob } from '../../../app/game-api/src/battleSim/processor.js';
import type { BattleSimJobPayload, BattleSimRequestPayload } from '../../../app/game-api/src/battleSim/types.js';

interface ReferenceTrace {
    engine: 'ref';
    conquered: boolean;
    events: WarBattleTraceEvent[];
    rng: RandomCall[];
    logs: {
        attacker: ReferenceLogBuckets;
        defenders: Record<string, ReferenceLogBuckets>;
        city: ReferenceLogBuckets;
    };
}

interface ReferenceLogBuckets {
    generalHistoryLog: string[];
    generalActionLog: string[];
    generalBattleResultLog: string[];
    generalBattleDetailLog: string[];
    nationalHistoryLog: string[];
    globalHistoryLog: string[];
    globalActionLog: string[];
}

interface RandomCall {
    seq: number;
    operation: string;
    arguments: Record<string, unknown>;
    result: unknown;
}

interface ReferenceItemMetadata {
    rawName: string;
    name: string;
    info: string;
    cost: number | null;
    buyable: boolean;
    consumable: boolean;
    reqSecu: number;
}

type ReferenceTraitCatalog = Record<
    'nation' | 'domestic' | 'war' | 'personality',
    Record<string, { name: string; info: string }>
>;

class TracingRng implements RNG {
    public readonly calls: RandomCall[] = [];

    public constructor(private readonly inner: RNG) {}

    public getMaxInt(): number {
        return this.inner.getMaxInt();
    }

    public nextBytes(bytes: number): Uint8Array<ArrayBuffer> {
        const result = this.inner.nextBytes(bytes);
        this.record('nextBytes', { bytes }, Buffer.from(result).toString('hex'));
        return result;
    }

    public nextBits(bits: number): Uint8Array<ArrayBuffer> {
        const result = this.inner.nextBits(bits);
        this.record('nextBits', { bits }, Buffer.from(result).toString('hex'));
        return result;
    }

    public nextInt(max?: number): number {
        const result = this.inner.nextInt(max);
        this.record('nextInt', { maxInclusive: max ?? null }, result);
        return result;
    }

    public nextFloat1(): number {
        const result = this.inner.nextFloat1();
        this.record('nextFloat1', {}, result);
        return result;
    }

    private record(operation: string, args: Record<string, unknown>, result: unknown): void {
        this.calls.push({ seq: this.calls.length, operation, arguments: args, result });
    }
}

const findWorkspaceRoot = (start: string): string | null => {
    let current = path.resolve(start);
    while (true) {
        if (
            fs.existsSync(path.join(current, 'docker_compose_files/reference/compose.yml')) &&
            fs.existsSync(path.join(current, 'ref/sam/hwe/compare/battle_trace.php'))
        ) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
};

const readJson = <T>(filePath: string): T => JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;

const runReferenceTrace = (workspaceRoot: string, fixtureJson: string): ReferenceTrace => {
    const compareSourceRoot = process.env.REF_COMPARE_SOURCE_ROOT;
    if (compareSourceRoot) {
        const resolvedCompareRoot = path.resolve(compareSourceRoot);
        const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sammo-ref-battle-'));
        fs.cpSync(resolvedCompareRoot, runtimeRoot, {
            recursive: true,
            filter: (source) => {
                const relative = path.relative(resolvedCompareRoot, source);
                return !(
                    relative === '.git' ||
                    relative.startsWith(`.git${path.sep}`) ||
                    relative === 'vendor' ||
                    relative.startsWith(`vendor${path.sep}`) ||
                    relative === 'd_log' ||
                    relative.startsWith(`d_log${path.sep}`) ||
                    relative === path.join('hwe', 'd_setting') ||
                    relative.startsWith(`${path.join('hwe', 'd_setting')}${path.sep}`)
                );
            },
        });
        fs.mkdirSync(path.join(runtimeRoot, 'd_log'));
        try {
            const stdout = execFileSync(
                'docker',
                [
                    'run',
                    '--rm',
                    '-i',
                    '-v',
                    `${runtimeRoot}:/var/www/html`,
                    '-v',
                    `${path.join(workspaceRoot, 'ref/sam/vendor')}:/var/www/html/vendor:ro`,
                    '-v',
                    `${path.join(workspaceRoot, 'ref/sam/hwe/d_setting')}:/var/www/html/hwe/d_setting:ro`,
                    'sam-rebuild-ref-php:8.3',
                    'php',
                    '-d',
                    'display_errors=0',
                    '-d',
                    'log_errors=0',
                    '/var/www/html/hwe/compare/battle_trace.php',
                    '-',
                ],
                {
                    input: fixtureJson,
                    encoding: 'utf8',
                    stdio: ['pipe', 'pipe', 'pipe'],
                }
            );
            return JSON.parse(stdout) as ReferenceTrace;
        } finally {
            fs.rmSync(runtimeRoot, { recursive: true, force: true });
        }
    }
    const stdout = execFileSync(
        'docker',
        ['compose', 'exec', '-T', 'php', 'php', '/var/www/html/hwe/compare/battle_trace.php', '-'],
        {
            cwd: path.join(workspaceRoot, 'docker_compose_files/reference'),
            input: fixtureJson,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }
    );
    return JSON.parse(stdout) as ReferenceTrace;
};

const runReferenceItemCatalog = (workspaceRoot: string, itemKeys: string[]): Record<string, ReferenceItemMetadata> => {
    const stdout = execFileSync(
        'docker',
        ['compose', 'exec', '-T', 'php', 'php', '/var/www/html/hwe/compare/item_catalog.php'],
        {
            cwd: path.join(workspaceRoot, 'docker_compose_files/reference'),
            input: JSON.stringify(itemKeys),
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }
    );
    return JSON.parse(stdout) as Record<string, ReferenceItemMetadata>;
};

const runReferenceTraitCatalog = (workspaceRoot: string): ReferenceTraitCatalog => {
    const stdout = execFileSync(
        'docker',
        ['compose', 'exec', '-T', 'php', 'php', '/var/www/html/hwe/compare/trait_catalog.php'],
        {
            cwd: path.join(workspaceRoot, 'docker_compose_files/reference'),
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }
    );
    return JSON.parse(stdout) as ReferenceTraitCatalog;
};

const expectNearlyEqual = (actual: unknown, expected: unknown, label: string): void => {
    expect(typeof actual, `${label}: actual type`).toBe('number');
    expect(typeof expected, `${label}: reference type`).toBe('number');
    if (process.env['STRICT_BATTLE_PARITY'] === '1') {
        expect(actual, `${label}: exact battle parity`).toBe(expected);
        return;
    }
    const reference = expected as number;
    const tolerance = Math.max(1, Math.abs(reference) * 0.01);
    expect(
        Math.abs((actual as number) - reference),
        `${label}: core=${String(actual)}, ref=${String(expected)}, tolerance=${tolerance}`
    ).toBeLessThanOrEqual(tolerance);
};

const normalizeRandomArguments = (value: Record<string, unknown>): Record<string, unknown> =>
    Array.isArray(value) && value.length === 0 ? {} : value;

const assertTraceParity = (
    coreEvents: WarBattleTraceEvent[],
    reference: ReferenceTrace,
    coreRng: TracingRng | null
): void => {
    const coreEventNames = coreEvents.map((event) => event.event);
    const referenceEventNames = reference.events.map((event) => event.event);
    expect(
        coreEventNames,
        `event sequence\ncore=${JSON.stringify(coreEventNames)}\nref=${JSON.stringify(referenceEventNames)}`
    ).toEqual(referenceEventNames);
    expect(
        coreRng?.calls.map(({ seq, operation, arguments: args, result }) => ({
            seq,
            operation,
            arguments: normalizeRandomArguments(args),
            result,
        }))
    ).toEqual(
        reference.rng.map(({ seq, operation, arguments: args, result }) => ({
            seq,
            operation,
            arguments: normalizeRandomArguments(args),
            result,
        }))
    );

    for (let index = 0; index < reference.events.length; index += 1) {
        const core = coreEvents[index]!;
        const ref = reference.events[index]!;
        expectNearlyEqual(core.attacker.hp, ref.attacker.hp, `event ${index} attacker.hp`);
        expectNearlyEqual(core.attacker.warPower, ref.attacker.warPower, `event ${index} attacker.warPower`);
        expect(core.attacker.phase, `event ${index} attacker.phase`).toBe(ref.attacker.phase);
        expect(core.attacker.realPhase, `event ${index} attacker.realPhase`).toBe(ref.attacker.realPhase);
        expect(core.attacker.maxPhase, `event ${index} attacker.maxPhase`).toBe(ref.attacker.maxPhase);
        if (core.defender && ref.defender) {
            expect(core.defender.kind, `event ${index} defender.kind`).toBe(ref.defender.kind);
            expectNearlyEqual(core.defender.hp, ref.defender.hp, `event ${index} defender.hp`);
            expectNearlyEqual(core.defender.warPower, ref.defender.warPower, `event ${index} defender.warPower`);
            expect(core.defender.phase, `event ${index} defender.phase`).toBe(ref.defender.phase);
            expect(core.defender.realPhase, `event ${index} defender.realPhase`).toBe(ref.defender.realPhase);
            expect(core.defender.maxPhase, `event ${index} defender.maxPhase`).toBe(ref.defender.maxPhase);
        } else {
            expect(core.defender, `event ${index} defender presence`).toBe(ref.defender);
        }
        if (core.event === 'phase_damage') {
            for (const key of ['rawDeadAttacker', 'rawDeadDefender', 'deadAttacker', 'deadDefender']) {
                expectNearlyEqual(core.details[key], ref.details[key], `event ${index} ${key}`);
            }
        }
    }
};

const configuredWorkspaceRoot = process.env.TURN_DIFFERENTIAL_WORKSPACE_ROOT;
const workspaceRoot = configuredWorkspaceRoot ?? findWorkspaceRoot(process.cwd());
if (process.env.TURN_DIFFERENTIAL_REFERENCE === '1' && !workspaceRoot) {
    throw new Error(
        'TURN_DIFFERENTIAL_REFERENCE=1 requires TURN_DIFFERENTIAL_WORKSPACE_ROOT when running outside the workspace tree.'
    );
}
const describeWithReference = workspaceRoot ? describe : describe.skip;

describeWithReference('ref ↔ core2026 battle differential', () => {
    it('matches all scenario effects across general, direct-city, and fresh-defender combat', () => {
        const unitSet = readJson<UnitSetDefinition>(
            path.resolve(process.cwd(), '../../resources/unitset/unitset_che.json')
        );
        const config: WarEngineConfig = {
            armPerPhase: 500,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            maxTrainByWar: 110,
            maxAtmosByWar: 150,
            castleCrewTypeId: 1000,
            armTypes: { footman: 1, archer: 2, cavalry: 3, wizard: 4, siege: 5, misc: 6, castle: 0 },
        };
        const cases: Array<{
            name: string;
            effect: string;
            directCity?: boolean;
            multipleDefenders?: boolean;
        }> = [
            { name: 'unlimited-general', effect: 'event_UnlimitedDefenceThresholdChange' },
            { name: 'strong-general', effect: 'event_StrongAttacker' },
            { name: 'more-general', effect: 'event_MoreEffect' },
            { name: 'strong-city', effect: 'event_StrongAttacker', directCity: true },
            { name: 'more-city', effect: 'event_MoreEffect', directCity: true },
            { name: 'strong-fresh-defender', effect: 'event_StrongAttacker', multipleDefenders: true },
        ];

        for (const entry of cases) {
            const base = readJson<BattleSimRequestPayload & { startYear: number; scenarioEffect?: string }>(
                path.resolve(process.cwd(), 'fixtures/battle/basic-infantry.json')
            );
            base.seed = `battle-differential-scenario-${entry.name}`;
            base.scenarioEffect = entry.effect;
            base.attackerGeneral.crew = entry.multipleDefenders ? 5000 : 3000;
            if (entry.directCity) {
                base.defenderGenerals = [];
            }
            if (entry.multipleDefenders) {
                base.defenderGenerals[0]!.crew = 1;
            }
            if (entry.multipleDefenders) {
                base.defenderGenerals.push({
                    ...base.defenderGenerals[0]!,
                    no: 3,
                    name: '새 수비자',
                    crew: 1200,
                    leadership: 1,
                    strength: 1,
                    intel: 1,
                });
            }

            const coreEvents: WarBattleTraceEvent[] = [];
            let coreRng: TracingRng | null = null;
            const coreResult = processBattleSimJob(
                {
                    ...base,
                    unitSet,
                    config,
                    time: { year: base.year, month: base.month, startYear: base.startYear },
                    scenarioEffect: entry.effect,
                },
                {
                    trace: (event) => coreEvents.push(event),
                    rngFactory: (seed) => {
                        coreRng = new TracingRng(LiteHashDRBG.build(seed));
                        return new RandUtil(coreRng);
                    },
                }
            );

            try {
                const reference = runReferenceTrace(workspaceRoot!, JSON.stringify(base));
                assertTraceParity(coreEvents, reference, coreRng);
                const opponentSwitches = coreEvents.filter((event) => event.event === 'opponent_switched');
                if (entry.directCity) {
                    expect(
                        coreEvents.some(
                            (event) => event.event === 'opponent_initialized' && event.defender?.kind === 'city'
                        ),
                        `${entry.name}: must execute direct city combat`
                    ).toBe(true);
                }
                if (entry.multipleDefenders) {
                    expect(
                        opponentSwitches.some((event) => event.defender?.kind === 'general' && event.defender.id === 3),
                        `${entry.name}: must transition to the fresh defender`
                    ).toBe(true);
                    const switchedIndex = coreEvents.findIndex(
                        (event) =>
                            event.event === 'opponent_switched' &&
                            event.defender?.kind === 'general' &&
                            event.defender.id === 3
                    );
                    const maxPhaseBeforeAdvance = coreEvents[switchedIndex]!.attacker.maxPhase;
                    expect(
                        coreEvents
                            .slice(switchedIndex + 1)
                            .some(
                                (event) =>
                                    event.event === 'phase_triggered' &&
                                    event.attacker.maxPhase === maxPhaseBeforeAdvance + 1
                            ),
                        `${entry.name}: advance trigger must extend attacker phases after the switch`
                    ).toBe(true);
                    expect(reference.logs.attacker.generalBattleDetailLog).toContain(
                        '<C>●</>적군의 전멸에 <C>진격</>이 이어집니다!'
                    );
                    expect(reference.logs.defenders['3']?.generalBattleDetailLog).toContain(
                        '<C>●</>아군의 전멸에 상대의 <R>진격</>이 이어집니다!'
                    );
                    expect(coreResult.lastWarLog?.generalBattleDetailLog).toContain(
                        '적군의 전멸에 <font color=cyan>진격</font>이 이어집니다!'
                    );
                }
            } catch (error) {
                throw new Error(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`, {
                    cause: error,
                });
            }
        }
    });

    it('matches every legacy trait name and description', async () => {
        const reference = runReferenceTraitCatalog(workspaceRoot!);
        const [nation, domestic, war, personality] = await Promise.all([
            loadNationTraitModules([...NATION_TRAIT_KEYS]),
            loadDomesticTraitModules([...DOMESTIC_TRAIT_KEYS]),
            loadWarTraitModules([...WAR_TRAIT_KEYS]),
            loadPersonalityTraitModules([...PERSONALITY_TRAIT_KEYS]),
        ]);
        const groups = { nation, domestic, war, personality };
        const failures: string[] = [];
        for (const [kind, modules] of Object.entries(groups) as Array<
            [keyof ReferenceTraitCatalog, Array<{ key: string; name: string; info: string }>]
        >) {
            expect(modules.map((module) => module.key).sort()).toEqual(Object.keys(reference[kind]).sort());
            for (const module of modules) {
                const actual = { name: module.name, info: module.info };
                if (JSON.stringify(actual) !== JSON.stringify(reference[kind][module.key])) {
                    failures.push(
                        `${kind}/${module.key}: core=${JSON.stringify(actual)} ref=${JSON.stringify(reference[kind][module.key])}`
                    );
                }
            }
        }
        expect(failures, failures.join('\n')).toEqual([]);
    });

    it('matches every event-domestic, war, personality, and nation trait in battle', { timeout: 180_000 }, () => {
        const unitSet = readJson<UnitSetDefinition>(
            path.resolve(process.cwd(), '../../resources/unitset/unitset_che.json')
        );
        const config: WarEngineConfig = {
            armPerPhase: 500,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            maxTrainByWar: 110,
            maxAtmosByWar: 150,
            castleCrewTypeId: 1000,
            armTypes: { footman: 1, archer: 2, cavalry: 3, wizard: 4, siege: 5, misc: 6, castle: 0 },
        };
        const cases = [
            ...EVENT_DOMESTIC_TRAIT_KEYS.map((key) => ({
                kind: 'eventDomestic' as const,
                key,
            })),
            ...WAR_TRAIT_KEYS.map((key) => ({ kind: 'war' as const, key })),
            ...PERSONALITY_TRAIT_KEYS.map((key) => ({ kind: 'personality' as const, key })),
            ...NATION_TRAIT_KEYS.map((key) => ({ kind: 'nation' as const, key })),
            {
                kind: 'dualSlot' as const,
                key: 'che_event_무쌍+che_무쌍',
                special: 'che_event_무쌍',
                special2: 'che_무쌍',
            },
            {
                kind: 'dualSlot' as const,
                key: 'che_event_견고+che_견고',
                special: 'che_event_견고',
                special2: 'che_견고',
            },
        ];

        for (const entry of cases) {
            const base = readJson<BattleSimRequestPayload & { startYear: number }>(
                path.resolve(process.cwd(), 'fixtures/battle/basic-infantry.json')
            );
            base.seed = `battle-differential-trait-${entry.kind}-${entry.key}`;
            base.attackerGeneral.crew = 5000;
            base.attackerGeneral.leadership = 90;
            base.attackerGeneral.strength = 85;
            base.attackerGeneral.intel = 80;
            base.attackerGeneral.special =
                entry.kind === 'dualSlot'
                    ? entry.special
                    : entry.kind === 'eventDomestic'
                      ? entry.key
                      : 'None';
            base.attackerGeneral.special2 =
                entry.kind === 'dualSlot'
                    ? entry.special2
                    : entry.kind === 'war'
                      ? entry.key
                      : 'None';
            base.attackerGeneral.personal = entry.kind === 'personality' ? entry.key : 'None';
            if (entry.kind === 'nation') {
                base.attackerNation.type = entry.key;
            }

            const coreEvents: WarBattleTraceEvent[] = [];
            let coreRng: TracingRng | null = null;
            processBattleSimJob(
                {
                    ...base,
                    unitSet,
                    config,
                    time: { year: base.year, month: base.month, startYear: base.startYear },
                },
                {
                    trace: (event) => coreEvents.push(event),
                    rngFactory: (seed) => {
                        coreRng = new TracingRng(LiteHashDRBG.build(seed));
                        return new RandUtil(coreRng);
                    },
                }
            );
            try {
                assertTraceParity(coreEvents, runReferenceTrace(workspaceRoot!, JSON.stringify(base)), coreRng);
            } catch (error) {
                throw new Error(
                    `${entry.kind}/${entry.key}: ${error instanceof Error ? error.message : String(error)}`,
                    {
                        cause: error,
                    }
                );
            }
        }
    });

    it('loads every scenario item with the scenario slot', async () => {
        const scenarioDir = path.resolve(process.cwd(), '../../resources/scenario');
        const itemSlots = new Map<string, 'horse' | 'weapon' | 'book' | 'item'>();
        for (const filename of fs.readdirSync(scenarioDir).filter((entry) => entry.endsWith('.json'))) {
            const scenario = readJson<{
                const?: {
                    allItems?: Partial<Record<'horse' | 'weapon' | 'book' | 'item', Record<string, number>>>;
                };
            }>(path.join(scenarioDir, filename));
            for (const slot of ['horse', 'weapon', 'book', 'item'] as const) {
                for (const itemKey of Object.keys(scenario.const?.allItems?.[slot] ?? {})) {
                    itemSlots.set(itemKey, slot);
                }
            }
        }

        const modules = await loadItemModules([...ITEM_KEYS]);
        const reference = runReferenceItemCatalog(workspaceRoot!, [...ITEM_KEYS]);
        expect(modules).toHaveLength(145);
        const failures: string[] = [];
        for (const module of modules) {
            const actual = {
                rawName: module.rawName,
                name: module.name,
                info: module.info,
                cost: module.cost,
                buyable: module.buyable,
                consumable: module.consumable,
                reqSecu: module.reqSecu,
            };
            if (
                module.slot !== itemSlots.get(module.key) ||
                module.unique !== !reference[module.key]?.buyable ||
                JSON.stringify(actual) !== JSON.stringify(reference[module.key])
            ) {
                failures.push(
                    `${module.key}: slot=${module.slot}/${String(itemSlots.get(module.key))} unique=${String(module.unique)}/${String(!reference[module.key]?.buyable)} core=${JSON.stringify(actual)} ref=${JSON.stringify(reference[module.key])}`
                );
            }
        }
        expect(failures, failures.join('\n')).toEqual([]);
    });

    it('matches the legacy non-stacking rule for the 무쌍 trait item', () => {
        const base = readJson<BattleSimRequestPayload & { startYear: number }>(
            path.resolve(process.cwd(), 'fixtures/battle/basic-infantry.json')
        );
        base.seed = 'battle-differential-duplicate-musang';
        base.attackerGeneral.personal = 'None';
        base.attackerGeneral.special2 = 'che_무쌍';
        base.attackerGeneral.item = 'event_전투특기_무쌍';
        base.attackerGeneral.crew = 5000;
        base.attackerGeneral.leadership = 90;
        base.attackerGeneral.strength = 90;
        base.attackerGeneral.intel = 90;
        base.attackerGeneral.dex1 = 12000;
        const unitSet = readJson<UnitSetDefinition>(
            path.resolve(process.cwd(), '../../resources/unitset/unitset_che.json')
        );
        const config: WarEngineConfig = {
            armPerPhase: 500,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            maxTrainByWar: 110,
            maxAtmosByWar: 150,
            castleCrewTypeId: 1000,
            armTypes: { footman: 1, archer: 2, cavalry: 3, wizard: 4, siege: 5, misc: 6, castle: 0 },
        };
        const coreEvents: WarBattleTraceEvent[] = [];
        let coreRng: TracingRng | null = null;
        processBattleSimJob(
            {
                ...base,
                unitSet,
                config,
                time: { year: base.year, month: base.month, startYear: base.startYear },
            },
            {
                trace: (event) => coreEvents.push(event),
                rngFactory: (seed) => {
                    coreRng = new TracingRng(LiteHashDRBG.build(seed));
                    return new RandUtil(coreRng);
                },
            }
        );
        assertTraceParity(coreEvents, runReferenceTrace(workspaceRoot!, JSON.stringify(base)), coreRng);
    });

    it('matches 척사 items against region-restricted troops', () => {
        const unitSet = readJson<UnitSetDefinition>(
            path.resolve(process.cwd(), '../../resources/unitset/unitset_che.json')
        );
        const config: WarEngineConfig = {
            armPerPhase: 500,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            maxTrainByWar: 110,
            maxAtmosByWar: 150,
            castleCrewTypeId: 1000,
            armTypes: { footman: 1, archer: 2, cavalry: 3, wizard: 4, siege: 5, misc: 6, castle: 0 },
        };

        for (const itemKey of ['che_척사_오악진형도', 'event_전투특기_척사']) {
            const base = readJson<BattleSimRequestPayload & { startYear: number }>(
                path.resolve(process.cwd(), 'fixtures/battle/basic-infantry.json')
            );
            base.seed = `battle-differential-region-item-${itemKey}`;
            base.attackerGeneral.personal = 'None';
            base.attackerGeneral.special2 = 'None';
            base.attackerGeneral.item = itemKey;
            base.attackerGeneral.crew = 5000;
            base.defenderGenerals[0]!.crewtype = 1101;
            const coreEvents: WarBattleTraceEvent[] = [];
            let coreRng: TracingRng | null = null;
            processBattleSimJob(
                {
                    ...base,
                    unitSet,
                    config,
                    time: { year: base.year, month: base.month, startYear: base.startYear },
                },
                {
                    trace: (event) => coreEvents.push(event),
                    rngFactory: (seed) => {
                        coreRng = new TracingRng(LiteHashDRBG.build(seed));
                        return new RandUtil(coreRng);
                    },
                }
            );
            assertTraceParity(coreEvents, runReferenceTrace(workspaceRoot!, JSON.stringify(base)), coreRng);
        }
    });

    it('keeps the detailed event sequence and phase values within 1%', () => {
        const fixturePath = path.resolve(process.cwd(), 'fixtures/battle/basic-infantry.json');
        const fixtureJson = fs.readFileSync(fixturePath, 'utf8');
        const request = JSON.parse(fixtureJson) as BattleSimRequestPayload & { startYear: number };
        const unitSet = readJson<UnitSetDefinition>(
            path.resolve(process.cwd(), '../../resources/unitset/unitset_che.json')
        );
        const castleCrewTypeId = 1000;
        const config: WarEngineConfig = {
            armPerPhase: 500,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            maxTrainByWar: 110,
            maxAtmosByWar: 150,
            castleCrewTypeId,
            armTypes: {
                footman: 1,
                archer: 2,
                cavalry: 3,
                wizard: 4,
                siege: 5,
                misc: 6,
                castle: unitSet.crewTypes?.find((crewType) => crewType.id === castleCrewTypeId)?.armType ?? 0,
            },
        };
        const payload: BattleSimJobPayload = {
            ...request,
            unitSet,
            config,
            time: { year: request.year, month: request.month, startYear: request.startYear },
        };

        const coreEvents: WarBattleTraceEvent[] = [];
        let coreRng: TracingRng | null = null;
        const coreResult = processBattleSimJob(payload, {
            trace: (event) => coreEvents.push(event),
            rngFactory: (seed) => {
                coreRng = new TracingRng(LiteHashDRBG.build(seed));
                return new RandUtil(coreRng);
            },
        });
        const reference = runReferenceTrace(workspaceRoot!, fixtureJson);

        expect(coreResult.result).toBe(true);
        assertTraceParity(coreEvents, reference, coreRng);
    });

    it('matches wizard strategy attempts, outcomes, and RNG consumption', () => {
        const base = readJson<BattleSimRequestPayload & { startYear: number }>(
            path.resolve(process.cwd(), 'fixtures/battle/basic-infantry.json')
        );
        base.seed = 'battle-differential-magic-v1';
        base.attackerGeneral.crew = 4000;
        base.attackerGeneral.crewtype = 1400;
        base.attackerGeneral.leadership = 60;
        base.attackerGeneral.strength = 30;
        base.attackerGeneral.intel = 95;
        base.attackerGeneral.special2 = 'che_신산';
        base.attackerGeneral.personal = 'che_재간';
        base.attackerGeneral.dex4 = 12000;
        base.defenderGenerals[0]!.crew = 4000;
        base.defenderGenerals[0]!.crewtype = 1100;
        base.defenderGenerals[0]!.leadership = 65;
        base.defenderGenerals[0]!.strength = 75;
        base.defenderGenerals[0]!.intel = 35;
        base.defenderGenerals[0]!.special2 = 'che_견고';
        base.defenderGenerals[0]!.personal = 'che_유지';

        const fixtureJson = JSON.stringify(base);
        const unitSet = readJson<UnitSetDefinition>(
            path.resolve(process.cwd(), '../../resources/unitset/unitset_che.json')
        );
        const config: WarEngineConfig = {
            armPerPhase: 500,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            maxTrainByWar: 110,
            maxAtmosByWar: 150,
            castleCrewTypeId: 1000,
            armTypes: { footman: 1, archer: 2, cavalry: 3, wizard: 4, siege: 5, misc: 6, castle: 0 },
        };
        const payload: BattleSimJobPayload = {
            ...base,
            unitSet,
            config,
            time: { year: base.year, month: base.month, startYear: base.startYear },
        };
        const coreEvents: WarBattleTraceEvent[] = [];
        let coreRng: TracingRng | null = null;
        const result = processBattleSimJob(payload, {
            trace: (event) => coreEvents.push(event),
            rngFactory: (seed) => {
                coreRng = new TracingRng(LiteHashDRBG.build(seed));
                return new RandUtil(coreRng);
            },
        });
        const reference = runReferenceTrace(workspaceRoot!, fixtureJson);

        expect(result.result).toBe(true);
        expect(
            reference.events.some((event) =>
                Object.keys(event.attacker.activatedSkills).some((skill) => ['계략', '계략실패'].includes(skill))
            )
        ).toBe(true);
        assertTraceParity(coreEvents, reference, coreRng);
    });

    it('matches cavalry, item, inherit-buff, and multiple-defender handling', () => {
        const base = readJson<BattleSimRequestPayload & { startYear: number }>(
            path.resolve(process.cwd(), 'fixtures/battle/basic-infantry.json')
        );
        base.seed = 'battle-differential-cavalry-items-v1';
        base.attackerGeneral.crew = 7000;
        base.attackerGeneral.crewtype = 1300;
        base.attackerGeneral.leadership = 88;
        base.attackerGeneral.strength = 92;
        base.attackerGeneral.intel = 55;
        base.attackerGeneral.special2 = 'che_기병';
        base.attackerGeneral.personal = 'che_패권';
        base.attackerGeneral.horse = 'che_명마_07_백상';
        base.attackerGeneral.dex3 = 18000;
        base.attackerGeneral.inheritBuff = {
            warAvoidRatio: 2,
            warCriticalRatio: 3,
            warCriticalRatioOppose: 2,
        };

        const firstDefender = base.defenderGenerals[0]!;
        firstDefender.crew = 900;
        firstDefender.crewtype = 1200;
        firstDefender.leadership = 58;
        firstDefender.strength = 55;
        firstDefender.intel = 62;
        firstDefender.dex2 = 6000;
        firstDefender.inheritBuff = { warAvoidRatioOppose: 2 };
        base.defenderGenerals.push({
            ...firstDefender,
            no: 3,
            name: '수비자2',
            crew: 1100,
            crewtype: 1300,
            leadership: 64,
            strength: 72,
            intel: 48,
            dex2: 0,
            dex3: 8000,
            special2: 'che_기병',
            personal: 'che_패권',
            horse: 'che_명마_07_백상',
            inheritBuff: {
                warAvoidRatio: 1,
                warCriticalRatioOppose: 1,
            },
        });

        const fixtureJson = JSON.stringify(base);
        const unitSet = readJson<UnitSetDefinition>(
            path.resolve(process.cwd(), '../../resources/unitset/unitset_che.json')
        );
        const config: WarEngineConfig = {
            armPerPhase: 500,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            maxTrainByWar: 110,
            maxAtmosByWar: 150,
            castleCrewTypeId: 1000,
            armTypes: { footman: 1, archer: 2, cavalry: 3, wizard: 4, siege: 5, misc: 6, castle: 0 },
        };
        const payload: BattleSimJobPayload = {
            ...base,
            unitSet,
            config,
            time: { year: base.year, month: base.month, startYear: base.startYear },
        };
        const coreEvents: WarBattleTraceEvent[] = [];
        let coreRng: TracingRng | null = null;
        const result = processBattleSimJob(payload, {
            trace: (event) => coreEvents.push(event),
            rngFactory: (seed) => {
                coreRng = new TracingRng(LiteHashDRBG.build(seed));
                return new RandUtil(coreRng);
            },
        });
        const reference = runReferenceTrace(workspaceRoot!, fixtureJson);

        expect(result.result).toBe(true);
        expect(reference.events.filter((event) => event.event === 'opponent_switched')).toHaveLength(2);
        assertTraceParity(coreEvents, reference, coreRng);
    });

    it('matches siege dexterity and castle damage handling', () => {
        const base = readJson<BattleSimRequestPayload & { startYear: number }>(
            path.resolve(process.cwd(), 'fixtures/battle/basic-infantry.json')
        );
        base.seed = 'battle-differential-siege-v1';
        base.attackerGeneral.crew = 5000;
        base.attackerGeneral.crewtype = 1501;
        base.attackerGeneral.leadership = 90;
        base.attackerGeneral.strength = 65;
        base.attackerGeneral.intel = 55;
        base.attackerGeneral.dex5 = 16000;
        base.defenderGenerals[0]!.crew = 300;
        base.defenderGenerals[0]!.crewtype = 1200;
        base.defenderGenerals[0]!.leadership = 65;
        base.defenderGenerals[0]!.strength = 72;
        base.defenderGenerals[0]!.intel = 50;
        base.defenderGenerals[0]!.dex2 = 10000;

        const fixtureJson = JSON.stringify(base);
        const unitSet = readJson<UnitSetDefinition>(
            path.resolve(process.cwd(), '../../resources/unitset/unitset_che.json')
        );
        const config: WarEngineConfig = {
            armPerPhase: 500,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            maxTrainByWar: 110,
            maxAtmosByWar: 150,
            castleCrewTypeId: 1000,
            armTypes: { footman: 1, archer: 2, cavalry: 3, wizard: 4, siege: 5, misc: 6, castle: 0 },
        };
        const payload: BattleSimJobPayload = {
            ...base,
            unitSet,
            config,
            time: { year: base.year, month: base.month, startYear: base.startYear },
        };
        const coreEvents: WarBattleTraceEvent[] = [];
        let coreRng: TracingRng | null = null;
        const result = processBattleSimJob(payload, {
            trace: (event) => coreEvents.push(event),
            rngFactory: (seed) => {
                coreRng = new TracingRng(LiteHashDRBG.build(seed));
                return new RandUtil(coreRng);
            },
        });
        const reference = runReferenceTrace(workspaceRoot!, fixtureJson);

        expect(result.result).toBe(true);
        expect(reference.events.some((event) => event.defender?.kind === 'city')).toBe(true);
        assertTraceParity(coreEvents, reference, coreRng);
    });

    it('matches the no-defender supply-retreat branch without consuming RNG', () => {
        const base = readJson<BattleSimRequestPayload & { startYear: number }>(
            path.resolve(process.cwd(), 'fixtures/battle/basic-infantry.json')
        );
        base.seed = 'battle-differential-supply-v1';
        base.defenderGenerals = [];
        base.defenderNation.rice = 0;

        const fixtureJson = JSON.stringify(base);
        const unitSet = readJson<UnitSetDefinition>(
            path.resolve(process.cwd(), '../../resources/unitset/unitset_che.json')
        );
        const config: WarEngineConfig = {
            armPerPhase: 500,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            maxTrainByWar: 110,
            maxAtmosByWar: 150,
            castleCrewTypeId: 1000,
            armTypes: { footman: 1, archer: 2, cavalry: 3, wizard: 4, siege: 5, misc: 6, castle: 0 },
        };
        const payload: BattleSimJobPayload = {
            ...base,
            unitSet,
            config,
            time: { year: base.year, month: base.month, startYear: base.startYear },
        };
        const coreEvents: WarBattleTraceEvent[] = [];
        let coreRng: TracingRng | null = null;
        const result = processBattleSimJob(payload, {
            trace: (event) => coreEvents.push(event),
            rngFactory: (seed) => {
                coreRng = new TracingRng(LiteHashDRBG.build(seed));
                return new RandUtil(coreRng);
            },
        });
        const reference = runReferenceTrace(workspaceRoot!, fixtureJson);

        expect(result.result).toBe(true);
        expect(reference.events.map((event) => event.event)).toEqual(['battle_start', 'supply_retreat', 'battle_end']);
        assertTraceParity(coreEvents, reference, coreRng);
    });

    it('matches every scenario item in an attacker battle simulation', { timeout: 180_000 }, () => {
        const scenarioDir = path.resolve(process.cwd(), '../../resources/scenario');
        const itemSlots = new Map<string, 'horse' | 'weapon' | 'book' | 'item'>();
        for (const filename of fs.readdirSync(scenarioDir).filter((entry) => entry.endsWith('.json'))) {
            const scenario = readJson<{
                const?: {
                    allItems?: Partial<Record<'horse' | 'weapon' | 'book' | 'item', Record<string, number>>>;
                };
            }>(path.join(scenarioDir, filename));
            for (const slot of ['horse', 'weapon', 'book', 'item'] as const) {
                for (const itemKey of Object.keys(scenario.const?.allItems?.[slot] ?? {})) {
                    itemSlots.set(itemKey, slot);
                }
            }
        }
        expect(itemSlots.size).toBe(145);
        expect([...ITEM_KEYS].sort()).toEqual([...itemSlots.keys()].sort());

        const unitSet = readJson<UnitSetDefinition>(
            path.resolve(process.cwd(), '../../resources/unitset/unitset_che.json')
        );
        const config: WarEngineConfig = {
            armPerPhase: 500,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            maxTrainByWar: 110,
            maxAtmosByWar: 150,
            castleCrewTypeId: 1000,
            armTypes: {
                footman: 1,
                archer: 2,
                cavalry: 3,
                wizard: 4,
                siege: 5,
                misc: 6,
                castle: 0,
            },
        };
        const failures: string[] = [];

        const itemFilter = process.env['ITEM_PARITY_FILTER'];
        for (const [itemKey, slot] of [...itemSlots].sort(([lhs], [rhs]) => lhs.localeCompare(rhs))) {
            if (itemFilter && itemKey !== itemFilter) {
                continue;
            }
            const base = readJson<BattleSimRequestPayload & { startYear: number }>(
                path.resolve(process.cwd(), 'fixtures/battle/basic-infantry.json')
            );
            base.seed = `battle-differential-item-${itemKey}`;
            base.attackerGeneral.personal = 'None';
            base.attackerGeneral.special2 = 'None';
            base.attackerGeneral.crew = 5000;
            base.attackerGeneral.leadership = 90;
            base.attackerGeneral.strength = 90;
            base.attackerGeneral.intel = 90;
            base.attackerGeneral.dex1 = 12000;
            base.attackerGeneral.dex2 = 12000;
            base.attackerGeneral.dex3 = 12000;
            base.attackerGeneral.dex4 = 12000;
            base.attackerGeneral.dex5 = 12000;
            base.attackerGeneral[slot] = itemKey;
            const defender = base.defenderGenerals[0]!;
            defender.personal = 'None';
            defender.special2 = 'None';
            defender.crew = 1500;
            defender.leadership = 75;
            defender.strength = 75;
            defender.intel = 75;
            base.defenderCity.wall = 3000;
            base.defenderCity.wall_max = 3000;

            const payload: BattleSimJobPayload = {
                ...base,
                unitSet,
                config,
                time: { year: base.year, month: base.month, startYear: base.startYear },
            };
            const coreEvents: WarBattleTraceEvent[] = [];
            let coreRng: TracingRng | null = null;
            processBattleSimJob(payload, {
                trace: (event) => coreEvents.push(event),
                rngFactory: (seed) => {
                    coreRng = new TracingRng(LiteHashDRBG.build(seed));
                    return new RandUtil(coreRng);
                },
            });
            const reference = runReferenceTrace(workspaceRoot!, JSON.stringify(base));
            try {
                assertTraceParity(coreEvents, reference, coreRng);
            } catch (error) {
                const debug =
                    process.env['ITEM_PARITY_DEBUG'] === '1'
                        ? `\ncore=${JSON.stringify(
                              coreEvents
                                  .map((event, index) => ({ index, event }))
                                  .filter(
                                      ({ event }) => event.event === 'phase_power' || event.event === 'phase_damage'
                                  )
                          )}\nref=${JSON.stringify(
                              reference.events
                                  .map((event, index) => ({ index, event }))
                                  .filter(
                                      ({ event }) => event.event === 'phase_power' || event.event === 'phase_damage'
                                  )
                          )}`
                        : '';
                failures.push(`${itemKey}: ${error instanceof Error ? error.message : String(error)}${debug}`);
            }
        }
        expect(failures, failures.join('\n')).toEqual([]);
    });

    it('matches every scenario item in a defender battle simulation', { timeout: 180_000 }, () => {
        const scenarioDir = path.resolve(process.cwd(), '../../resources/scenario');
        const itemSlots = new Map<string, 'horse' | 'weapon' | 'book' | 'item'>();
        for (const filename of fs.readdirSync(scenarioDir).filter((entry) => entry.endsWith('.json'))) {
            const scenario = readJson<{
                const?: {
                    allItems?: Partial<Record<'horse' | 'weapon' | 'book' | 'item', Record<string, number>>>;
                };
            }>(path.join(scenarioDir, filename));
            for (const slot of ['horse', 'weapon', 'book', 'item'] as const) {
                for (const itemKey of Object.keys(scenario.const?.allItems?.[slot] ?? {})) {
                    itemSlots.set(itemKey, slot);
                }
            }
        }

        const unitSet = readJson<UnitSetDefinition>(
            path.resolve(process.cwd(), '../../resources/unitset/unitset_che.json')
        );
        const config: WarEngineConfig = {
            armPerPhase: 500,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            maxTrainByWar: 110,
            maxAtmosByWar: 150,
            castleCrewTypeId: 1000,
            armTypes: {
                footman: 1,
                archer: 2,
                cavalry: 3,
                wizard: 4,
                siege: 5,
                misc: 6,
                castle: 0,
            },
        };
        const failures: string[] = [];

        const itemFilter = process.env['ITEM_PARITY_FILTER'];
        for (const [itemKey, slot] of [...itemSlots].sort(([lhs], [rhs]) => lhs.localeCompare(rhs))) {
            if (itemFilter && itemKey !== itemFilter) {
                continue;
            }
            const base = readJson<BattleSimRequestPayload & { startYear: number }>(
                path.resolve(process.cwd(), 'fixtures/battle/basic-infantry.json')
            );
            base.seed = `battle-differential-defender-item-${itemKey}`;
            base.attackerGeneral.personal = 'None';
            base.attackerGeneral.special2 = 'None';
            base.attackerGeneral.crew = 1500;
            base.attackerGeneral.leadership = 75;
            base.attackerGeneral.strength = 75;
            base.attackerGeneral.intel = 75;
            const defender = base.defenderGenerals[0]!;
            defender.personal = 'None';
            defender.special2 = 'None';
            defender.crew = 5000;
            defender.leadership = 90;
            defender.strength = 90;
            defender.intel = 90;
            defender.dex1 = 12000;
            defender.dex2 = 12000;
            defender.dex3 = 12000;
            defender.dex4 = 12000;
            defender.dex5 = 12000;
            defender[slot] = itemKey;

            const payload: BattleSimJobPayload = {
                ...base,
                unitSet,
                config,
                time: { year: base.year, month: base.month, startYear: base.startYear },
            };
            const coreEvents: WarBattleTraceEvent[] = [];
            let coreRng: TracingRng | null = null;
            processBattleSimJob(payload, {
                trace: (event) => coreEvents.push(event),
                rngFactory: (seed) => {
                    coreRng = new TracingRng(LiteHashDRBG.build(seed));
                    return new RandUtil(coreRng);
                },
            });
            const reference = runReferenceTrace(workspaceRoot!, JSON.stringify(base));
            try {
                assertTraceParity(coreEvents, reference, coreRng);
            } catch (error) {
                const debug =
                    process.env['ITEM_PARITY_DEBUG'] === '1'
                        ? `\ncore=${JSON.stringify(
                              coreEvents
                                  .map((event, index) => ({ index, event }))
                                  .filter(
                                      ({ event }) => event.event === 'phase_power' || event.event === 'phase_damage'
                                  )
                          )}\nref=${JSON.stringify(
                              reference.events
                                  .map((event, index) => ({ index, event }))
                                  .filter(
                                      ({ event }) => event.event === 'phase_power' || event.event === 'phase_damage'
                                  )
                          )}`
                        : '';
                failures.push(`${itemKey}: ${error instanceof Error ? error.message : String(error)}${debug}`);
            }
        }
        expect(failures, failures.join('\n')).toEqual([]);
    });
});
