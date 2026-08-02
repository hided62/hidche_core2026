export interface TournamentBracketParticipant {
    id: number;
    name: string;
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
    advanced: boolean;
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

const emptySlot = (): TournamentBracketSlot => ({ id: null, name: '-', advanced: false });

export const buildTournamentBracket = (
    participants: TournamentBracketParticipant[],
    matches: TournamentBracketMatch[],
    winnerId?: number
): TournamentBracketModel => {
    const participantsById = new Map(participants.map((participant) => [participant.id, participant]));
    const nameOf = (id: number | null): string =>
        id === null ? '-' : (participantsById.get(id)?.name ?? `#${id}`);

    const buildRound = (stage: number, slotCount: number): TournamentBracketRound => {
        const roundMatches = matches
            .filter((match) => match.stage === stage)
            .sort((lhs, rhs) => lhs.roundIndex - rhs.roundIndex || lhs.id - rhs.id);
        const slots: TournamentBracketSlot[] = roundMatches.flatMap((match) =>
            [match.attackerId, match.defenderId].map((id) => ({
                id,
                name: nameOf(id),
                advanced: match.winnerId === id,
            }))
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
            name: nameOf(resolvedWinnerId),
            advanced: resolvedWinnerId !== null,
        },
        final,
        semi: buildRound(9, 4),
        quarter: buildRound(8, 8),
        top16: buildRound(7, 16),
    };
};
