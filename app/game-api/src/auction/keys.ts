export interface AuctionTimerKeys {
    timerKey: string;
    historyKey: string;
}

export const buildAuctionTimerKeys = (profileName: string): AuctionTimerKeys => ({
    timerKey: `sammo:${profileName}:auction:timer`,
    historyKey: `sammo:${profileName}:auction:timer:history`,
});
