import type { City, General, Nation, Troop } from '@sammo-ts/logic/domain/entities.js';
import type { ScenarioConfig } from '@sammo-ts/logic/scenario/types.js';
import type { ScenarioMeta } from '@sammo-ts/logic/world/types.js';

// DB에서 월드 상태를 로드할 때 사용하는 조회 인터페이스.
export interface WorldStateSnapshotSource<
    GeneralType extends General = General,
    CityType extends City = City,
    NationType extends Nation = Nation,
    TroopType extends Troop = Troop,
> {
    listGenerals(): Promise<GeneralType[]>;
    listCities(): Promise<CityType[]>;
    listNations(): Promise<NationType[]>;
    listTroops(): Promise<TroopType[]>;
}

export interface ScenarioConfigSource {
    loadScenarioConfig(): Promise<ScenarioConfig>;
    loadScenarioMeta?(): Promise<ScenarioMeta | undefined>;
}
