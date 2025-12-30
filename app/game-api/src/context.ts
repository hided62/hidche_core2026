import type { GameSessionTokenPayload } from '@sammo-ts/common';
import type { DatabaseClient as InfraDatabaseClient } from '@sammo-ts/infra';

import type { TurnDaemonTransport } from './daemon/transport.js';

export interface GameProfile {
    id: string;
    scenario: string;
    name: string;
}

export interface WorldStateRow {
    scenarioCode: string;
    currentYear: number;
    currentMonth: number;
    tickSeconds: number;
    config: unknown;
    meta: unknown;
    updatedAt: Date;
}

export interface GeneralRow {
    id: number;
    name: string;
    nationId: number;
    cityId: number;
    troopId: number;
    leadership: number;
    strength: number;
    intel: number;
    experience: number;
    dedication: number;
    officerLevel: number;
    personalCode: string;
    specialCode: string;
    special2Code: string;
    horseCode: string;
    weaponCode: string;
    bookCode: string;
    itemCode: string;
    injury: number;
    gold: number;
    rice: number;
    crew: number;
    crewTypeId: number;
    train: number;
    age: number;
    npcState: number;
    meta: unknown;
}

export interface GeneralTurnRow {
    id: number;
    generalId: number;
    turnIdx: number;
    actionCode: string;
    arg: unknown;
}

export interface NationTurnRow {
    id: number;
    nationId: number;
    officerLevel: number;
    turnIdx: number;
    actionCode: string;
    arg: unknown;
}

export interface CityRow {
    id: number;
    name: string;
    nationId: number;
    level: number;
    population: number;
    populationMax: number;
    agriculture: number;
    agricultureMax: number;
    commerce: number;
    commerceMax: number;
    security: number;
    securityMax: number;
    supplyState: number;
    frontState: number;
    defence: number;
    defenceMax: number;
    wall: number;
    wallMax: number;
    meta: unknown;
}

export interface NationRow {
    id: number;
    name: string;
    color: string;
    capitalCityId: number | null;
    gold: number;
    rice: number;
    level: number;
    typeCode: string;
    meta: unknown;
}

export type DatabaseClient = InfraDatabaseClient<
    WorldStateRow,
    GeneralRow,
    CityRow,
    NationRow,
    GeneralTurnRow,
    NationTurnRow
>;

export interface GameApiContext {
    db: DatabaseClient;
    turnDaemon: TurnDaemonTransport;
    profile: GameProfile;
    auth: GameSessionTokenPayload | null;
}

export const createGameApiContext = (options: {
    db: DatabaseClient;
    turnDaemon: TurnDaemonTransport;
    profile: GameProfile;
    auth: GameSessionTokenPayload | null;
}): GameApiContext => {
    return {
        db: options.db,
        turnDaemon: options.turnDaemon,
        profile: options.profile,
        auth: options.auth,
    };
};
