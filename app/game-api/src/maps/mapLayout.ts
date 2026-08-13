import { loadScenarioDefinitionById } from '@sammo-ts/game-engine/scenario/scenarioLoader.js';
import type { ScenarioDefinition } from '@sammo-ts/logic';

import { loadMapDefinitionByName, loadRegionDisplayMapByName } from './mapDefinition.js';

export interface MapLayoutCity {
    id: number;
    name: string;
    level: number;
    region: number;
    x: number;
    y: number;
    path: number[];
}

export interface MapLayout {
    mapName: string;
    cityList: MapLayoutCity[];
    regionMap: Record<number, string>;
    levelMap: Record<number, string>;
}

export interface MapLayoutLoaderOptions {
    loadScenario?: (scenarioId: number) => Promise<ScenarioDefinition>;
    loadMap?: typeof loadMapDefinitionByName;
    loadRegionMap?: typeof loadRegionDisplayMapByName;
}

const layoutCache = new Map<string, MapLayout>();

const CITY_LEVEL_MAP: Record<number, string> = {
    1: '수',
    2: '진',
    3: '관',
    4: '이',
    5: '소',
    6: '중',
    7: '대',
    8: '특',
};

const parseScenarioId = (scenario: string): number | null => {
    const normalized = scenario.replace(/^scenario_/i, '').replace(/\.json$/i, '');
    if (!/^\d+$/.test(normalized)) {
        return null;
    }
    const scenarioId = Number(normalized);
    return Number.isSafeInteger(scenarioId) ? scenarioId : null;
};

const resolveMapName = async (
    scenario: string,
    loadScenario: (scenarioId: number) => Promise<ScenarioDefinition>
): Promise<string> => {
    const scenarioId = parseScenarioId(scenario);
    if (scenarioId === null) {
        return 'che';
    }
    try {
        const definition = await loadScenario(scenarioId);
        return definition.config.environment.mapName;
    } catch {
        // 운영 DB가 보존된 상태에서 해당 commit에 scenario resource가 없을 수
        // 있으므로 기존 기본 map인 che로 안전하게 돌아갑니다.
        return 'che';
    }
};

export const loadMapLayout = async (scenario: string, options: MapLayoutLoaderOptions = {}): Promise<MapLayout> => {
    const mapName = await resolveMapName(scenario, options.loadScenario ?? loadScenarioDefinitionById);
    const useCache = !options.loadScenario && !options.loadMap && !options.loadRegionMap;
    const cached = useCache ? layoutCache.get(mapName) : undefined;
    if (cached) {
        return cached;
    }

    const [map, regionMap] = await Promise.all([
        (options.loadMap ?? loadMapDefinitionByName)(mapName),
        (options.loadRegionMap ?? loadRegionDisplayMapByName)(mapName),
    ]);
    const layout: MapLayout = {
        mapName,
        cityList: map.cities.map((city) => ({
            id: city.id,
            name: city.name,
            level: city.level,
            region: city.region,
            x: city.position.x,
            y: city.position.y,
            path: [...city.connections],
        })),
        regionMap,
        levelMap: CITY_LEVEL_MAP,
    };

    if (useCache) {
        layoutCache.set(mapName, layout);
    }
    return layout;
};
