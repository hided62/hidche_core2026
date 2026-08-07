import { describe, expect, it, vi } from 'vitest';

import { loadMapLayout } from '../src/maps/mapLayout.js';

describe('map layout resource adapter', () => {
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

        await expect(loadMapLayout('scenario_2601.json', { loadScenario, loadMap })).resolves.toEqual({
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
            regionMap: {},
            levelMap: {},
        });
        expect(loadScenario).toHaveBeenCalledWith(2601);
        expect(loadMap).toHaveBeenCalledWith('custom-map');
    });

    it('retains the che fallback for unknown preserved scenarios', async () => {
        const loadMap = vi.fn().mockResolvedValue({ cities: [] });

        await expect(
            loadMapLayout('custom-runtime', {
                loadScenario: vi.fn(),
                loadMap,
            })
        ).resolves.toMatchObject({ mapName: 'che' });
        expect(loadMap).toHaveBeenCalledWith('che');
    });
});
