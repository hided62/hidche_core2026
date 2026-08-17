import { buildGameEventChannel } from '@sammo-ts/common';

export interface TournamentKeys {
    stateKey: string;
    participantsKey: string;
    matchesKey: string;
    bettingKey: string;
    sourceRevisionKey: string;
    sourceRevisionChannel: string;
    realtimeEventChannel: string;
}

export const buildTournamentKeys = (profileName: string): TournamentKeys => ({
    stateKey: `sammo:${profileName}:tournament:state`,
    participantsKey: `sammo:${profileName}:tournament:participants`,
    matchesKey: `sammo:${profileName}:tournament:matches`,
    bettingKey: `sammo:${profileName}:tournament:betting`,
    sourceRevisionKey: `sammo:${profileName}:tournament:source-revision`,
    sourceRevisionChannel: `sammo:${profileName}:tournament:source-changed`,
    realtimeEventChannel: buildGameEventChannel(profileName),
});
