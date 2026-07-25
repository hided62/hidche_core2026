import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { LiteHashDRBG, RandUtil, type RNG } from '@sammo-ts/common';
import type { UnitSetDefinition, WarBattleTraceEvent, WarEngineConfig } from '@sammo-ts/logic';
import { describe, expect, it } from 'vitest';

import { processBattleSimJob } from '../../../app/game-api/src/battleSim/processor.js';
import type { BattleSimJobPayload, BattleSimRequestPayload } from '../../../app/game-api/src/battleSim/types.js';

interface ReferenceTrace {
    engine: 'ref';
    conquered: boolean;
    events: WarBattleTraceEvent[];
    rng: RandomCall[];
}

interface RandomCall {
    seq: number;
    operation: string;
    arguments: Record<string, unknown>;
    result: unknown;
}

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
    const stdout = execFileSync(
        'docker',
        [
            'compose',
            'exec',
            '-T',
            'php',
            'php',
            '/var/www/html/hwe/compare/battle_trace.php',
            '-',
        ],
        {
            cwd: path.join(workspaceRoot, 'docker_compose_files/reference'),
            input: fixtureJson,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }
    );
    return JSON.parse(stdout) as ReferenceTrace;
};

const expectNearlyEqual = (actual: unknown, expected: unknown, label: string): void => {
    expect(typeof actual, `${label}: actual type`).toBe('number');
    expect(typeof expected, `${label}: reference type`).toBe('number');
    const reference = expected as number;
    const tolerance = Math.max(1, Math.abs(reference) * 0.01);
    expect(
        Math.abs((actual as number) - reference),
        `${label}: core=${String(actual)}, ref=${String(expected)}, tolerance=${tolerance}`
    ).toBeLessThanOrEqual(tolerance);
};

const assertTraceParity = (
    coreEvents: WarBattleTraceEvent[],
    reference: ReferenceTrace,
    coreRng: TracingRng | null
): void => {
    expect(coreEvents.map((event) => event.event)).toEqual(reference.events.map((event) => event.event));
    expect(coreRng?.calls.map(({ operation, result }) => ({ operation, result }))).toEqual(
        reference.rng.map(({ operation, result }) => ({ operation, result }))
    );

    for (let index = 0; index < reference.events.length; index += 1) {
        const core = coreEvents[index]!;
        const ref = reference.events[index]!;
        expectNearlyEqual(core.attacker.hp, ref.attacker.hp, `event ${index} attacker.hp`);
        expectNearlyEqual(core.attacker.warPower, ref.attacker.warPower, `event ${index} attacker.warPower`);
        if (core.defender && ref.defender) {
            expect(core.defender.kind, `event ${index} defender.kind`).toBe(ref.defender.kind);
            expectNearlyEqual(core.defender.hp, ref.defender.hp, `event ${index} defender.hp`);
            expectNearlyEqual(core.defender.warPower, ref.defender.warPower, `event ${index} defender.warPower`);
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

const workspaceRoot = findWorkspaceRoot(process.cwd());
const describeWithReference = workspaceRoot ? describe : describe.skip;

describeWithReference('ref ↔ core2026 battle differential', () => {
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
        expect(reference.events.map((event) => event.event)).toEqual([
            'battle_start',
            'supply_retreat',
            'battle_end',
        ]);
        assertTraceParity(coreEvents, reference, coreRng);
    });
});
