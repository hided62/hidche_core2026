export const TournamentType = {
    TOTAL: 0,
    LEADERSHIP: 1,
    STRENGTH: 2,
    INTEL: 3,
} as const;

export type TournamentType = (typeof TournamentType)[keyof typeof TournamentType];

export interface TournamentStats {
    leadership: number;
    strength: number;
    intel: number;
}

export interface TournamentParticipant {
    id: number;
    name: string;
    stats: TournamentStats;
    level: number;
}

export interface TournamentBattleLogEntry {
    phase: number;
    attackerEnergy: number;
    defenderEnergy: number;
    attackerDamage: number;
    defenderDamage: number;
    text: string;
}

export interface TournamentBattleResult {
    winnerId: number | null;
    loserId: number | null;
    draw: boolean;
    rounds: number;
    totalDamage: {
        attacker: number;
        defender: number;
    };
    log: string[];
    logEntries: TournamentBattleLogEntry[];
}

export interface TournamentBattleContext {
    openYear: number;
    openMonth: number;
    stage: number;
    phase: number;
    matchIndex: number;
}

export interface TournamentBattleInput {
    type: TournamentType;
    battleType: 0 | 1; // 0: 승무패, 1: 승패
    attacker: TournamentParticipant;
    defender: TournamentParticipant;
    context: TournamentBattleContext;
    baseSeed: string;
}
