export type AuctionStatus = 'OPEN' | 'FINALIZING' | 'FINISHED' | 'CANCELED';

export interface AuctionTimerRow {
    id: number;
    closeAt: Date;
    closeTick: bigint | null;
    status: AuctionStatus;
}

export interface AuctionFinalizeRequest {
    auctionId: number;
}
