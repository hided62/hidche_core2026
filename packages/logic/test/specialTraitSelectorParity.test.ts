import { describe, expect, it } from 'vitest';
import { RandUtil, type RNG } from '@sammo-ts/common';

import { TraitRequirement, TraitWeightType } from '../src/triggers/special/requirements.js';
import { TraitSelector } from '../src/triggers/special/selector.js';
import type { TraitModule } from '../src/triggers/special/types.js';

class ScriptedRng implements RNG {
    public floatCalls = 0;
    public intCalls = 0;

    constructor(
        private readonly floats: number[],
        private readonly ints: number[]
    ) {}

    getMaxInt(): number {
        return 0x7fff_ffff;
    }

    nextBytes(bytes: number): Uint8Array<ArrayBuffer> {
        return new Uint8Array(bytes);
    }

    nextBits(bits: number): Uint8Array<ArrayBuffer> {
        return new Uint8Array(Math.ceil(bits / 8));
    }

    nextInt(max = 0x7fff_ffff): number {
        const value = this.ints[this.intCalls++] ?? 0;
        return Math.max(0, Math.min(value, max));
    }

    nextFloat1(): number {
        return this.floats[this.floatCalls++] ?? 0;
    }
}

const scenarioStat = {
    total: 300,
    min: 10,
    max: 100,
    npcTotal: 150,
    npcMax: 75,
    npcMin: 10,
    chiefMin: 70,
};

const trait = (
    key: string,
    requirement: TraitRequirement,
    weightType = TraitWeightType.NORM,
    weight = 1
): TraitModule =>
    ({
        key,
        name: key,
        info: '',
        kind: 'domestic',
        selection: { requirements: [requirement], weightType, weight },
    }) as TraitModule;

describe('legacy speciality selector parity', () => {
    it('sets positive and negative stat bits in the legacy order', () => {
        expect(
            TraitSelector.calcCondGeneric(
                { leadership: 80, strength: 75, intelligence: 40 },
                scenarioStat
            )
        ).toBe(
            TraitRequirement.STAT_LEADERSHIP |
                TraitRequirement.STAT_STRENGTH |
                TraitRequirement.STAT_NOT_INTEL
        );
        expect(
            TraitSelector.calcCondGeneric(
                { leadership: 70, strength: 70, intelligence: 70 },
                scenarioStat
            )
        ).toBe(TraitRequirement.STAT_STRENGTH);
    });

    it('rounds the dex threshold and still consumes a value choice when every dex is zero', () => {
        const source = new ScriptedRng([0.9], [99, 4]);
        const result = TraitSelector.calcCondDexterity(new RandUtil(source), [0, 0, 0, 0, 0]);
        expect(result).toBe(0);
        expect(source.floatCalls).toBe(1);
        expect(source.intCalls).toBe(2);
    });

    it('uses one weighted absolute draw with a relative sentinel before the norm pool', () => {
        const source = new ScriptedRng([0.5, 0.1], []);
        const result = TraitSelector.pickDomesticTrait(
            new RandUtil(source),
            { leadership: 40, strength: 40, intelligence: 80 },
            [
                trait('rare', TraitRequirement.STAT_INTEL, TraitWeightType.PERCENT, 2.5),
                trait('normal-a', TraitRequirement.STAT_INTEL),
                trait('normal-b', TraitRequirement.STAT_INTEL),
            ],
            [],
            scenarioStat
        );
        expect(result).toBe('normal-a');
        expect(source.floatCalls).toBe(2);
    });

    it('retries without previous traits and reruns the war dex RNG path', () => {
        const source = new ScriptedRng([0.9, 0.9, 0.1], [99, 0, 99, 0]);
        const result = TraitSelector.pickWarTrait(
            new RandUtil(source),
            { leadership: 80, strength: 75, intelligence: 40 },
            [200, 10, 10, 10, 10],
            [
                trait(
                    'footman',
                    (TraitRequirement.STAT_LEADERSHIP |
                        TraitRequirement.REQ_DEXTERITY |
                        TraitRequirement.ARMY_FOOTMAN |
                        TraitRequirement.STAT_NOT_INTEL) as TraitRequirement
                ),
            ],
            ['footman'],
            scenarioStat
        );
        expect(result).toBe('footman');
        expect(source.floatCalls).toBe(3);
        expect(source.intCalls).toBe(4);
    });
});
