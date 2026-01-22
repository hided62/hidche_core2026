import type { GamePrisma, GamePrismaClient } from './gamePrisma.js';

export interface DatabaseClient {
    $transaction?: GamePrismaClient['$transaction'];
    $queryRaw: GamePrismaClient['$queryRaw'];
    $executeRaw: GamePrismaClient['$executeRaw'];
    worldState: GamePrisma.WorldStateDelegate;
    general: GamePrisma.GeneralDelegate;
    city: GamePrisma.CityDelegate;
    nation: GamePrisma.NationDelegate;
    diplomacy: GamePrisma.DiplomacyDelegate;
    generalTurn: GamePrisma.GeneralTurnDelegate;
    nationTurn: GamePrisma.NationTurnDelegate;
    troop: GamePrisma.TroopDelegate;
    logEntry: GamePrisma.LogEntryDelegate;
    inheritancePoint: GamePrisma.InheritancePointDelegate;
    inheritanceLog: GamePrisma.InheritanceLogDelegate;
    inheritanceResult: GamePrisma.InheritanceResultDelegate;
    inheritanceUserState: GamePrisma.InheritanceUserStateDelegate;
}
