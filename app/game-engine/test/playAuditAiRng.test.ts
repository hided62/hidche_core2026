import { describe, expect, it } from 'vitest';
import { LiteHashDRBG, RandUtil } from '@sammo-ts/common';
import { observeAiRng, type AiTraceStep } from '../src/turn/ai/generalAi/trace.js';

describe('AI RNG observation', () => {
    it.each(['audit-a', 'audit-b', 'audit-c'])(
        'preserves results, identity and following random state for %s',
        (seed) => {
            const baseline = new RandUtil(LiteHashDRBG.build(seed));
            const events: AiTraceStep[] = [];
            const observed = observeAiRng(new RandUtil(LiteHashDRBG.build(seed)), (event) => events.push(event));
            const candidates = [
                { id: 1, secret: 'hidden' },
                { id: 2, secret: 'hidden' },
            ];
            const draw = (rng: RandUtil) => [
                rng.nextFloat1(),
                rng.nextBool(0),
                rng.nextBool(1),
                rng.nextBool(0.5),
                rng.nextBool(0.3),
                rng.nextRange(-10, 100),
                rng.nextRangeInt(1, 30),
                rng.nextInt(1, 2),
                rng.nextIntInclusive(0),
                rng.choice([42]),
                rng.choice(candidates),
                rng.choice(new Set(candidates)),
                rng.choice({ first: candidates[0]!, second: candidates[1]! }),
                rng.choiceUsingWeight({ a: 0, b: 2, c: 3 }),
                rng.choiceUsingWeightPair([
                    [candidates[0]!, 2],
                    [candidates[1]!, 3],
                ]),
                rng.shuffle(candidates),
            ];
            const expected = draw(baseline);
            const actual = draw(observed);
            expect(actual).toEqual(expected);
            expect(actual[10]).toBe(expected[10]);
            expect(events).toHaveLength(16); // helper 내부 호출을 별도 판단으로 중복 기록하지 않는다.
            expect(JSON.stringify(events)).not.toContain('hidden');
            expect(JSON.stringify(events)).not.toContain(seed);
            expect(events[10]).toMatchObject({
                kind: 'RNG',
                method: 'choice',
                result: { entityId: candidates.indexOf(actual[10] as (typeof candidates)[number]) + 1 },
            });
            expect(observed.nextFloat1()).toBe(baseline.nextFloat1());
        }
    );
    it('does not fabricate successful observations for failed choices', () => {
        const events: AiTraceStep[] = [];
        const rng = observeAiRng(new RandUtil(LiteHashDRBG.build('error')), (step) => events.push(step));
        expect(() => rng.choice([])).toThrow('Empty items');
        expect(events).toEqual([]);
    });
    it('marks unsupported result shapes instead of copying arbitrary debug data', () => {
        const events: AiTraceStep[] = [];
        const rng = observeAiRng(new RandUtil(LiteHashDRBG.build('projection')), (step) => events.push(step));
        const value = { secret: 'not a candidate id' };
        expect(rng.choice([value])).toBe(value);
        expect(events).toEqual([{ kind: 'RNG', method: 'choice', parameters: null, result: { unprojected: true } }]);
    });
});
