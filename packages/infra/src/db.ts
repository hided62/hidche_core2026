import type { GamePrisma, GamePrismaClient } from './gamePrisma.js';

export interface DatabaseClient {
    $transaction: GamePrismaClient['$transaction'];
    $queryRaw: GamePrismaClient['$queryRaw'];
    worldState: GamePrisma.WorldStateDelegate;
    general: GamePrisma.GeneralDelegate;
    city: GamePrisma.CityDelegate;
    nation: GamePrisma.NationDelegate;
    generalTurn: GamePrisma.GeneralTurnDelegate;
    nationTurn: GamePrisma.NationTurnDelegate;
    troop: GamePrisma.TroopDelegate;
}
