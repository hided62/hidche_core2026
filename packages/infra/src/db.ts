import type { GamePrisma, GamePrismaClient } from './gamePrisma.js';

export interface DatabaseClient {
    $transaction?: GamePrismaClient['$transaction'];
    $queryRaw: GamePrismaClient['$queryRaw'];
    $executeRaw: GamePrismaClient['$executeRaw'];
    worldState: GamePrisma.WorldStateDelegate;
    general: GamePrisma.GeneralDelegate;
    generalAccessLog: GamePrisma.GeneralAccessLogDelegate;
    city: GamePrisma.CityDelegate;
    nation: GamePrisma.NationDelegate;
    diplomacy: GamePrisma.DiplomacyDelegate;
    diplomacyLetter: GamePrisma.DiplomacyLetterDelegate;
    yearbookHistory: GamePrisma.YearbookHistoryDelegate;
    rankData: GamePrisma.RankDataDelegate;
    hallOfFame: GamePrisma.HallOfFameDelegate;
    gameHistory: GamePrisma.GameHistoryDelegate;
    oldNation: GamePrisma.OldNationDelegate;
    oldGeneral: GamePrisma.OldGeneralDelegate;
    emperor: GamePrisma.EmperorDelegate;
    generalTurn: GamePrisma.GeneralTurnDelegate;
    nationTurn: GamePrisma.NationTurnDelegate;
    troop: GamePrisma.TroopDelegate;
    logEntry: GamePrisma.LogEntryDelegate;
    inheritancePoint: GamePrisma.InheritancePointDelegate;
    inheritanceLog: GamePrisma.InheritanceLogDelegate;
    inheritanceResult: GamePrisma.InheritanceResultDelegate;
    inheritanceUserState: GamePrisma.InheritanceUserStateDelegate;
    inputEvent: GamePrisma.InputEventDelegate;
}
