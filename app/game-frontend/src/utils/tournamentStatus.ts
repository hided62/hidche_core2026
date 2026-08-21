export const tournamentStageNames = [
    '경기 없음',
    '참가 모집중',
    '예선 진행중',
    '본선 추첨중',
    '본선 진행중',
    '16강 배정중',
    '베팅 진행중',
    '16강 진행중',
    '8강 진행중',
    '4강 진행중',
    '결승 진행중',
] as const;

export const resolveTournamentStageName = (stage: number): string => tournamentStageNames[stage] ?? '상태 확인 중';

export interface TournamentSectionVisibility {
    preliminary: boolean;
    final: boolean;
    knockout: boolean;
}

export const resolveTournamentSectionVisibility = (stage: number, winnerId?: number): TournamentSectionVisibility => {
    const completed = stage === 0 && winnerId !== undefined;
    return {
        preliminary: stage >= 1 || completed,
        final: stage >= 3 || completed,
        knockout: stage >= 5 || completed,
    };
};
