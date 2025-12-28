import type { City, General, Nation } from '../domain/entities.js';
import type { ScenarioConfig } from '../scenario/types.js';
import type { ScenarioMeta } from '../world/types.js';

// DB에서 월드 상태를 로드할 때 사용하는 조회 인터페이스.
export interface WorldStateSnapshotSource<
    GeneralType extends General = General,
    CityType extends City = City,
    NationType extends Nation = Nation
> {
    listGenerals(): Promise<GeneralType[]>;
    listCities(): Promise<CityType[]>;
    listNations(): Promise<NationType[]>;
}

export interface ScenarioConfigSource {
    loadScenarioConfig(): Promise<ScenarioConfig>;
    loadScenarioMeta?(): Promise<ScenarioMeta | undefined>;
}
