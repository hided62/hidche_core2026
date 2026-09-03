import { buildGameEventChannel } from '@sammo-ts/common';

export interface TournamentKeys {
    stateKey: string;
    participantsKey: string;
    matchesKey: string;
    bettingKey: string;
    sourceRevisionKey: string;
    sourceRevisionChannel: string;
    realtimeEventChannel: string;
    activeClockRevisionKey: string;
    deadlineGenerationKey: string;
    clockPhaseKey: string;
}

export const buildTournamentKeys = (profileName: string): TournamentKeys => ({
    stateKey: `sammo:${profileName}:tournament:state`,
    participantsKey: `sammo:${profileName}:tournament:participants`,
    matchesKey: `sammo:${profileName}:tournament:matches`,
    bettingKey: `sammo:${profileName}:tournament:betting`,
    sourceRevisionKey: `sammo:${profileName}:tournament:source-revision`,
    sourceRevisionChannel: `sammo:${profileName}:tournament:source-changed`,
    realtimeEventChannel: buildGameEventChannel(profileName),
    activeClockRevisionKey: `sammo:${profileName}:clock:active-revision`,
    deadlineGenerationKey: `sammo:${profileName}:clock:deadline-generation`,
    clockPhaseKey: `sammo:${profileName}:clock:phase`,
});
