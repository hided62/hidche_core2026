export interface TurnDaemonStreamKeys {
    commandStream: string;
    eventStream: string;
}

export const buildTurnDaemonStreamKeys = (profileName: string): TurnDaemonStreamKeys => {
    return {
        commandStream: `sammo:${profileName}:turn-daemon:commands`,
        eventStream: `sammo:${profileName}:turn-daemon:events`,
    };
};
