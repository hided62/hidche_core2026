export interface TournamentKeys {
    stateKey: string;
    participantsKey: string;
    matchesKey: string;
    bettingKey: string;
}

export const buildTournamentKeys = (profileName: string): TournamentKeys => ({
    stateKey: `sammo:${profileName}:tournament:state`,
    participantsKey: `sammo:${profileName}:tournament:participants`,
    matchesKey: `sammo:${profileName}:tournament:matches`,
    bettingKey: `sammo:${profileName}:tournament:betting`,
});
