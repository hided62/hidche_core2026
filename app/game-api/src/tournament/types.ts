import type { TournamentType } from '@sammo-ts/logic';

export interface TournamentState {
    stage: number;
    phase: number;
    type: TournamentType;
    auto: boolean;
    openYear: number;
    openMonth: number;
    termSeconds: number;
    nextAt: string;
    nextTick?: number;
    clockRevision?: number;
    deadlineGeneration?: number;
    bettingId?: number;
    bettingCloseAt?: string;
    bettingCloseTick?: number;
    winnerId?: number;
    bettingSettled?: boolean;
    rewardSettled?: boolean;
    participantsLockedAt?: string;
    lastError?: string;
    lastErrorAt?: string;
}

export interface TournamentParticipantEntry {
    id: number;
    name: string;
    leadership: number;
    strength: number;
    intel: number;
    level: number;
    groupId?: number;
    groupNo?: number;
    win?: number;
    draw?: number;
    lose?: number;
    gl?: number;
    seedRank?: number;
    finalRank?: number;
    preliminaryGroupId?: number;
    preliminaryGroupNo?: number;
    preliminaryRank?: number;
    preliminaryWin?: number;
    preliminaryDraw?: number;
    preliminaryLose?: number;
    preliminaryGl?: number;
}

export interface TournamentMatchEntry {
    id: number;
    stage: number;
    roundIndex: number;
    /** Ref fight{group}.txt와 같이 조별전의 최신 로그를 식별합니다. */
    groupId?: number;
    attackerId: number;
    defenderId: number;
    winnerId?: number;
    log?: string[];
    logEntries?: Array<{
        phase: number;
        attackerEnergy: number;
        defenderEnergy: number;
        attackerDamage: number;
        defenderDamage: number;
        text: string;
    }>;
    lastEnergy?: {
        attacker: number;
        defender: number;
    };
}

export interface TournamentBetEntry {
    generalId: number;
    targetId: number;
    amount: number;
}
