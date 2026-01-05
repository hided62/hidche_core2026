import type { City, General, Nation, Troop } from '@sammo-ts/logic/domain/entities.js';
import type { ScenarioConfig, ScenarioDiplomacy } from '@sammo-ts/logic/scenario/types.js';
import type { ScenarioConfigSource, WorldStateSnapshotSource } from '@sammo-ts/logic/ports/worldSnapshot.js';
import type { MapDefinition, ScenarioMeta, UnitSetDefinition, WorldSnapshot } from './types.js';

export interface WorldSnapshotLoadInput<
    GeneralType extends General = General,
    CityType extends City = City,
    NationType extends Nation = Nation,
    TroopType extends Troop = Troop,
> {
    worldSource: WorldStateSnapshotSource<GeneralType, CityType, NationType, TroopType>;
    scenarioConfig?: ScenarioConfig;
    scenarioMeta?: ScenarioMeta;
    scenarioSource?: ScenarioConfigSource;
    map: MapDefinition;
    unitSet?: UnitSetDefinition;
    diplomacy?: ScenarioDiplomacy[];
    events?: unknown[];
    initialEvents?: unknown[];
}

// DB 기반 월드 로더: 세계 상태와 시나리오 설정을 합쳐 스냅샷을 만든다.
export const loadWorldSnapshot = async <
    GeneralType extends General,
    CityType extends City,
    NationType extends Nation,
    TroopType extends Troop,
>(
    input: WorldSnapshotLoadInput<GeneralType, CityType, NationType, TroopType>
): Promise<WorldSnapshot> => {
    const { worldSource, scenarioSource } = input;

    const scenarioConfig =
        input.scenarioConfig ?? (scenarioSource ? await scenarioSource.loadScenarioConfig() : undefined);
    if (!scenarioConfig) {
        throw new Error('Scenario config is required to load world snapshot.');
    }

    const scenarioMeta =
        input.scenarioMeta ?? (scenarioSource?.loadScenarioMeta ? await scenarioSource.loadScenarioMeta() : undefined);

    const [generals, cities, nations, troops] = await Promise.all([
        worldSource.listGenerals(),
        worldSource.listCities(),
        worldSource.listNations(),
        worldSource.listTroops(),
    ]);

    return {
        scenarioConfig,
        ...(scenarioMeta ? { scenarioMeta } : {}),
        map: input.map,
        ...(input.unitSet ? { unitSet: input.unitSet } : {}),
        nations,
        cities,
        generals,
        troops,
        diplomacy: input.diplomacy ?? [],
        events: input.events ?? [],
        initialEvents: input.initialEvents ?? [],
    };
};
