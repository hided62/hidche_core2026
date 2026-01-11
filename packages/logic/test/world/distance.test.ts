import { describe, expect, it } from 'vitest';
import { getCityDistance, searchDistance } from '@sammo-ts/logic/world/distance.js';
import type { MapDefinition } from '@sammo-ts/logic/world/types.js';

describe('World Distance', () => {
    const mockMap: MapDefinition = {
        id: 'test_map',
        name: 'Test Map',
        cities: [
            { id: 1, connections: [2, 3] },
            { id: 2, connections: [1, 4] },
            { id: 3, connections: [1, 5] },
            { id: 4, connections: [2, 6] },
            { id: 5, connections: [3, 7] },
            { id: 6, connections: [4] },
            { id: 7, connections: [5] },
            // Isolated city
            { id: 8, connections: [] },
        ] as any[],
    };

    describe('getCityDistance', () => {
        it('should return 0 for same city', () => {
            expect(getCityDistance(mockMap, 1, 1)).to.equal(0);
        });

        it('should return 1 for adjacent cities', () => {
            expect(getCityDistance(mockMap, 1, 2)).to.equal(1);
            expect(getCityDistance(mockMap, 1, 3)).to.equal(1);
        });

        it('should return correct distance for distant cities', () => {
            expect(getCityDistance(mockMap, 1, 4)).to.equal(2); // 1-2-4
            expect(getCityDistance(mockMap, 1, 6)).to.equal(3); // 1-2-4-6
        });

        it('should return Infinity for unreachable cities', () => {
            expect(getCityDistance(mockMap, 1, 8)).to.equal(Infinity);
        });
    });

    describe('searchDistance', () => {
        it('should include start city with distance 0', () => {
            const result = searchDistance(mockMap, 1, 0);
            expect(result).to.deep.equal({ 1: 0 });
        });

        it('should find cities within range 1', () => {
            const result = searchDistance(mockMap, 1, 1);
            expect(result).to.deep.equal({
                1: 0,
                2: 1,
                3: 1,
            });
        });

        it('should find cities within range 2', () => {
            const result = searchDistance(mockMap, 1, 2);
            expect(result).to.deep.equal({
                1: 0,
                2: 1,
                3: 1,
                4: 2,
                5: 2,
            });
        });

        it('should not include unreachable cities', () => {
            const result = searchDistance(mockMap, 1, 10);
            expect(result).not.to.have.property('8');
        });
    });
});
