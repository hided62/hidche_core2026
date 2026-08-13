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
