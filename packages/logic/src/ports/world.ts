// 도메인 로직이 DB에 직접 접근하지 않도록 하는 인터페이스.

import type { City, CityId, General, GeneralId, Nation, NationId } from '@sammo-ts/logic/domain/entities.js';

export interface GeneralRepository<GeneralType extends General = General> {
    getById(id: GeneralId): Promise<GeneralType | null>;
    listByNation(nationId: NationId): Promise<GeneralType[]>;
    save(general: GeneralType): Promise<void>;
}

export interface CityRepository<CityType extends City = City> {
    getById(id: CityId): Promise<CityType | null>;
    listByNation(nationId: NationId): Promise<CityType[]>;
    save(city: CityType): Promise<void>;
}

export interface NationRepository<NationType extends Nation = Nation> {
    getById(id: NationId): Promise<NationType | null>;
    listAll(): Promise<NationType[]>;
    save(nation: NationType): Promise<void>;
}

export interface WorldStateReader<
    GeneralType extends General = General,
    CityType extends City = City,
    NationType extends Nation = Nation,
> {
    getGeneralById(id: GeneralId): Promise<GeneralType | null>;
    getCityById(id: CityId): Promise<CityType | null>;
    getNationById(id: NationId): Promise<NationType | null>;
}

export interface WorldStateWriter<
    GeneralType extends General = General,
    CityType extends City = City,
    NationType extends Nation = Nation,
> {
    saveGeneral(general: GeneralType): Promise<void>;
    saveCity(city: CityType): Promise<void>;
    saveNation(nation: NationType): Promise<void>;
}

export interface WorldStateRepository<
    GeneralType extends General = General,
    CityType extends City = City,
    NationType extends Nation = Nation,
>
    extends WorldStateReader<GeneralType, CityType, NationType>, WorldStateWriter<GeneralType, CityType, NationType> {}
