import type { GameSessionTokenPayload } from '@sammo-ts/common';
import type { DatabaseClient as InfraDatabaseClient, RedisConnector } from '@sammo-ts/infra';

import type { TurnDaemonTransport } from './daemon/transport.js';
import type { BattleSimTransport } from './battleSim/transport.js';

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
    atmos: number;
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
    trust: number;
    trade: number;
    supplyState: number;
    frontState: number;
    defence: number;
    defenceMax: number;
    wall: number;
    wallMax: number;
    region: number;
    meta: unknown;
}

export interface NationRow {
    id: number;
    name: string;
    color: string;
    capitalCityId: number | null;
    gold: number;
    rice: number;
    tech: number;
    level: number;
    typeCode: string;
    meta: unknown;
}

export interface TroopRow {
    troopLeaderId: number;
    nationId: number;
    name: string;
}

export type DatabaseClient = InfraDatabaseClient<
    WorldStateRow,
    GeneralRow,
    CityRow,
    NationRow,
    GeneralTurnRow,
    NationTurnRow,
    TroopRow
>;

export interface GameApiContext {
    db: DatabaseClient;
    redis: RedisConnector['client'];
    turnDaemon: TurnDaemonTransport;
    battleSim: BattleSimTransport;
    profile: GameProfile;
    auth: GameSessionTokenPayload | null;
}

export const createGameApiContext = (options: {
    db: DatabaseClient;
    redis: RedisConnector['client'];
    turnDaemon: TurnDaemonTransport;
    battleSim: BattleSimTransport;
    profile: GameProfile;
    auth: GameSessionTokenPayload | null;
}): GameApiContext => {
    return {
        db: options.db,
        redis: options.redis,
        turnDaemon: options.turnDaemon,
        battleSim: options.battleSim,
        profile: options.profile,
        auth: options.auth,
    };
};
