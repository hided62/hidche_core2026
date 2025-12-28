export interface RandomGenerator {
    nextFloat(): number;
    nextBool(probability: number): boolean;
    nextInt(minInclusive: number, maxExclusive: number): number;
}
