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
    bettingId?: number;
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
}

export interface TournamentMatchEntry {
    id: number;
    stage: number;
    roundIndex: number;
    attackerId: number;
    defenderId: number;
    winnerId?: number;
    log?: string[];
}
