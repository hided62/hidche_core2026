import type { City, General, Nation } from '@sammo-ts/logic/domain/entities.js';
import type { ScenarioConfig } from '@sammo-ts/logic/scenario/types.js';
import type { ScenarioMeta } from '@sammo-ts/logic/world/types.js';
import type { MapDefinition, UnitSetDefinition } from '@sammo-ts/logic/world/types.js';

export interface ActionRandomSource {
    nextFloat(): number;
    nextBool(probability: number): boolean;
    nextInt(minInclusive: number, maxExclusive: number): number;
}

export interface ActionContextGeneral extends General {
    turnTime: Date;
}

export type ActionContextBase = {
    general: ActionContextGeneral;
    city?: City;
    nation?: Nation | null;
    rng: ActionRandomSource;
};

export type ActionResolveContext = ActionContextBase & Record<string, unknown>;

export interface ActionContextWorldState {
    currentYear: number;
    currentMonth: number;
    tickSeconds: number;
}

export interface ActionContextWorldRef {
    listGenerals(): ActionContextGeneral[];
    listCities(): City[];
    listNations(): Nation[];
    listDiplomacy(): Array<{
        fromNationId: number;
        toNationId: number;
        state: number;
    }>;
    getGeneralById(id: number): ActionContextGeneral | null;
    getCityById(id: number): City | null;
    getNationById(id: number): Nation | null;
}

export interface ActionContextOptions {
    world: ActionContextWorldState;
    scenarioConfig: ScenarioConfig;
    scenarioMeta?: ScenarioMeta;
    map?: MapDefinition;
    unitSet?: UnitSetDefinition;
    worldRef: ActionContextWorldRef | null;
    actionArgs: Record<string, unknown>;
    createGeneralId: () => number;
    seedBase: string;
}

// 예약 턴 처리에서 커맨드별로 필요한 컨텍스트를 확장한다.
export type ActionContextBuilder = (
    base: ActionContextBase,
    options: ActionContextOptions
) => ActionResolveContext | null;

export const defaultActionContextBuilder: ActionContextBuilder = (base) => base;
