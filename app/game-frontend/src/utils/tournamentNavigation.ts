export interface TournamentMainPresentation {
    label: string;
    compactLabel: string;
    to: '/tournament' | '/betting';
    active: boolean;
    bettingActive: boolean;
}

const tournamentLabels = [
    { label: '전 력 전', compactLabel: '전력전' },
    { label: '통 솔 전', compactLabel: '통솔전' },
    { label: '일 기 토', compactLabel: '일기토' },
    { label: '설 전', compactLabel: '설전' },
] as const;

export const resolveTournamentMainPresentation = (
    tournamentStage: number,
    tournamentType: number | null
): TournamentMainPresentation => {
    const active = tournamentStage > 0 || tournamentType !== null;
    const bettingActive = tournamentStage === 6;
    const tournamentLabel = tournamentType === null ? undefined : tournamentLabels[tournamentType];
    return {
        label: bettingActive ? '베 팅 장' : (tournamentLabel?.label ?? '토 너 먼 트'),
        compactLabel: bettingActive ? '베팅장' : (tournamentLabel?.compactLabel ?? '토너먼트'),
        to: bettingActive ? '/betting' : '/tournament',
        active,
        bettingActive,
    };
};
