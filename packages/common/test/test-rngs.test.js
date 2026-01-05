import { describe, expect, it } from 'vitest';
import { ConstantRNG, MidpointRNG, SequenceRNG, SineRNG } from '../src/index.js';
const toArray = (bytes) => Array.from(bytes);
describe('TestRNG:Constant', () => {
    it('returns fixed 0', () => {
        const rng = new ConstantRNG(0);
        expect(rng.nextFloat1()).toBe(0);
        expect(rng.nextInt(10)).toBe(0);
        expect(toArray(rng.nextBytes(3))).toEqual([0, 0, 0]);
        expect(toArray(rng.nextBits(3))).toEqual([0]);
    });
    it('returns fixed 1', () => {
        const rng = new ConstantRNG(1);
        expect(rng.nextFloat1()).toBe(1);
        expect(rng.nextInt(10)).toBe(10);
        expect(toArray(rng.nextBytes(2))).toEqual([255, 255]);
        expect(toArray(rng.nextBits(3))).toEqual([7]);
    });
});
describe('TestRNG:Midpoint', () => {
    it('returns midpoint for int/float', () => {
        const rng = new MidpointRNG();
        expect(rng.nextFloat1()).toBe(0.5);
        expect(rng.nextInt(9)).toBe(4);
        expect(rng.nextInt(10)).toBe(5);
    });
    it('alternates bits', () => {
        const rng = new MidpointRNG();
        expect(toArray(rng.nextBits(4))).toEqual([10]);
        expect(toArray(rng.nextBits(4))).toEqual([10]);
    });
});
describe('TestRNG:Sine', () => {
    it('follows sine wave with period/amplitude', () => {
        const rng = new SineRNG(4, 0.5, 0);
        expect(rng.nextFloat1()).toBeCloseTo(0.5, 8);
        expect(rng.nextFloat1()).toBeCloseTo(1, 8);
        expect(rng.nextFloat1()).toBeCloseTo(0.5, 8);
        expect(rng.nextFloat1()).toBeCloseTo(0, 8);
    });
    it('maps float to int range', () => {
        const rng = new SineRNG(4, 0.5, 0);
        expect(rng.nextInt(9)).toBe(5);
        expect(rng.nextInt(9)).toBe(9);
    });
});
describe('TestRNG:Sequence', () => {
    it('cycles fixed sequence', () => {
        const rng = new SequenceRNG([0, 0.25, 0.5, 0.75, 1]);
        expect(rng.nextFloat1()).toBe(0);
        expect(rng.nextFloat1()).toBe(0.25);
        expect(rng.nextFloat1()).toBe(0.5);
        expect(rng.nextFloat1()).toBe(0.75);
        expect(rng.nextFloat1()).toBe(1);
        expect(rng.nextFloat1()).toBe(0);
    });
    it('converts sequence to bytes and ints', () => {
        const rng = new SequenceRNG([0, 0.5, 1]);
        expect(toArray(rng.nextBytes(3))).toEqual([0, 128, 255]);
        expect(rng.nextInt(8)).toBe(0);
        expect(rng.nextInt(8)).toBe(4);
        expect(rng.nextInt(8)).toBe(8);
    });
});
//# sourceMappingURL=test-rngs.test.js.map
