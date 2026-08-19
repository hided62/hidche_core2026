export interface TournamentBracketParticipant {
    id: number;
    name: string;
    picture?: string | null;
    imageServer?: number | null;
    leadership?: number;
    strength?: number;
    intel?: number;
}

export interface TournamentBracketMatch {
    id: number;
    stage: number;
    roundIndex: number;
    attackerId: number;
    defenderId: number;
    winnerId?: number;
}

export interface TournamentBracketSlot {
    id: number | null;
    name: string;
    picture: string | null;
    imageServer: number;
    advanced: boolean;
    leadership?: number;
    strength?: number;
    intel?: number;
}

export interface TournamentCoreStat {
    label: '종합' | '통솔' | '무력' | '지력';
    value: number;
}

export interface TournamentBracketRound {
    stage: number;
    slots: TournamentBracketSlot[];
}

export interface TournamentBracketModel {
    champion: TournamentBracketSlot;
    final: TournamentBracketRound;
    semi: TournamentBracketRound;
    quarter: TournamentBracketRound;
    top16: TournamentBracketRound;
}

const emptySlot = (): TournamentBracketSlot => ({
    id: null,
    name: '-',
    picture: null,
    imageServer: 0,
    advanced: false,
});

export const resolveTournamentCoreStat = (
    participant: Pick<TournamentBracketParticipant, 'leadership' | 'strength' | 'intel'>,
    tournamentType: number
): TournamentCoreStat | null => {
    const { leadership, strength, intel } = participant;
    if (leadership === undefined || strength === undefined || intel === undefined) return null;
    if (tournamentType === 0) return { label: '종합', value: leadership + strength + intel };
    if (tournamentType === 1) return { label: '통솔', value: leadership };
    if (tournamentType === 2) return { label: '무력', value: strength };
    return { label: '지력', value: intel };
};

export const buildTournamentBracket = (
    participants: TournamentBracketParticipant[],
    matches: TournamentBracketMatch[],
    winnerId?: number
): TournamentBracketModel => {
    const participantsById = new Map(participants.map((participant) => [participant.id, participant]));
    const participantOf = (id: number | null): TournamentBracketParticipant | null =>
        id === null ? null : (participantsById.get(id) ?? { id, name: `#${id}` });

    const buildRound = (stage: number, slotCount: number): TournamentBracketRound => {
        const roundMatches = matches
            .filter((match) => match.stage === stage)
            .sort((lhs, rhs) => lhs.roundIndex - rhs.roundIndex || lhs.id - rhs.id);
        const slots: TournamentBracketSlot[] = roundMatches.flatMap((match) =>
            [match.attackerId, match.defenderId].map((id) => {
                const participant = participantOf(id);
                return {
                    id,
                    name: participant?.name ?? '-',
                    picture: participant?.picture ?? null,
                    imageServer: participant?.imageServer ?? 0,
                    advanced: match.winnerId === id,
                    leadership: participant?.leadership,
                    strength: participant?.strength,
                    intel: participant?.intel,
                };
            })
        );
        while (slots.length < slotCount) {
            slots.push(emptySlot());
        }
        return { stage, slots: slots.slice(0, slotCount) };
    };

    const final = buildRound(10, 2);
    const resolvedWinnerId = winnerId ?? matches.find((match) => match.stage === 10)?.winnerId ?? null;

    return {
        champion: {
            id: resolvedWinnerId,
            name: participantOf(resolvedWinnerId)?.name ?? '-',
            picture: participantOf(resolvedWinnerId)?.picture ?? null,
            imageServer: participantOf(resolvedWinnerId)?.imageServer ?? 0,
            advanced: resolvedWinnerId !== null,
            leadership: participantOf(resolvedWinnerId)?.leadership,
            strength: participantOf(resolvedWinnerId)?.strength,
            intel: participantOf(resolvedWinnerId)?.intel,
        },
        final,
        semi: buildRound(9, 4),
        quarter: buildRound(8, 8),
        top16: buildRound(7, 16),
    };
};
