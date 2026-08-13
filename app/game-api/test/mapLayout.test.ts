import { describe, expect, it, vi } from 'vitest';

import { loadRegionDisplayMapByName } from '../src/maps/mapDefinition.js';
import { loadMapLayout } from '../src/maps/mapLayout.js';

describe('map layout resource adapter', () => {
    it('loads the Ref theme region labels from the shared resource', async () => {
        await expect(loadRegionDisplayMapByName('che')).resolves.toMatchObject({ 1: '하북', 8: '동이' });
        await expect(loadRegionDisplayMapByName('chess')).resolves.toMatchObject({ 1: '킹', 7: '빈칸' });
    });

    it('resolves the scenario map through the shared runtime loaders', async () => {
        const loadScenario = vi.fn().mockResolvedValue({
            config: { environment: { mapName: 'custom-map' } },
        });
        const loadMap = vi.fn().mockResolvedValue({
            cities: [
                {
                    id: 7,
                    name: '테스트 도시',
                    level: 3,
                    region: 2,
                    position: { x: 11, y: 13 },
                    connections: [8],
                },
            ],
        });

        const loadRegionMap = vi.fn().mockResolvedValue({ 2: '테스트권역' });

        await expect(loadMapLayout('scenario_2601.json', { loadScenario, loadMap, loadRegionMap })).resolves.toEqual({
            mapName: 'custom-map',
            cityList: [
                {
                    id: 7,
                    name: '테스트 도시',
                    level: 3,
                    region: 2,
                    x: 11,
                    y: 13,
                    path: [8],
                },
            ],
            regionMap: { 2: '테스트권역' },
            levelMap: { 1: '수', 2: '진', 3: '관', 4: '이', 5: '소', 6: '중', 7: '대', 8: '특' },
        });
        expect(loadScenario).toHaveBeenCalledWith(2601);
        expect(loadMap).toHaveBeenCalledWith('custom-map');
        expect(loadRegionMap).toHaveBeenCalledWith('custom-map');
    });

    it('retains the che fallback for unknown preserved scenarios', async () => {
        const loadMap = vi.fn().mockResolvedValue({ cities: [] });

        await expect(
            loadMapLayout('custom-runtime', {
                loadScenario: vi.fn(),
                loadMap,
                loadRegionMap: vi.fn().mockResolvedValue({}),
            })
        ).resolves.toMatchObject({ mapName: 'che' });
        expect(loadMap).toHaveBeenCalledWith('che');
    });
});
