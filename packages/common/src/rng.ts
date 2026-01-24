export interface RandomGenerator {
    nextFloat1(): number;
    nextBool(probability: number): boolean;
    nextInt(minInclusive: number, maxExclusive: number): number;
}
