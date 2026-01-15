import type { City, General, Nation, Troop } from '@sammo-ts/logic/domain/entities.js';
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
    listTroops(): Troop[];
    listDiplomacy(): Array<{
        fromNationId: number;
        toNationId: number;
        state: number;
    }>;
    getDiplomacyEntry(
        fromNationId: number,
        toNationId: number
    ): {
        fromNationId: number;
        toNationId: number;
        state: number;
        term: number;
        dead?: number;
        meta?: Record<string, unknown>;
    } | null;
    getGeneralById(id: number): ActionContextGeneral | null;
    getCityById(id: number): City | null;
    getNationById(id: number): Nation | null;
    getTroopById(id: number): Troop | null;
}

export interface ActionContextOptions<TArgs extends Record<string, unknown> = Record<string, unknown>> {
    world: ActionContextWorldState;
    scenarioConfig: ScenarioConfig;
    scenarioMeta?: ScenarioMeta;
    map?: MapDefinition;
    unitSet?: UnitSetDefinition;
    worldRef: ActionContextWorldRef | null;
    actionArgs: TArgs;
    createGeneralId: () => number;
    createNationId: () => number;
    seedBase: string;
}

// 예약 턴 처리에서 커맨드별로 필요한 컨텍스트를 확장한다.
export type ActionContextBuilder<TArgs extends Record<string, unknown> = Record<string, unknown>> = {
    bivarianceHack(base: ActionContextBase, options: ActionContextOptions<TArgs>): ActionResolveContext | null;
}['bivarianceHack'];

export const defaultActionContextBuilder: ActionContextBuilder = (base) => base;
