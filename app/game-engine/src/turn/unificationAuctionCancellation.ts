import { asRecord } from '@sammo-ts/common';
import { createGamePostgresConnector, GamePrisma } from '@sammo-ts/infra';

import type { PendingUnificationAuctionCancellation } from './types.js';

interface PendingAuctionRow {
    auctionId: number;
    status: 'OPEN' | 'FINALIZING';
    closeAt: Date;
    detail: unknown;
    highestBidId: number | null;
    bidderGeneralId: number | null;
    amount: number | null;
    highestBidMeta: unknown;
}

export const loadPendingUnificationAuctionCancellations = async (
    databaseUrl: string
): Promise<PendingUnificationAuctionCancellation[]> => {
    const connector = createGamePostgresConnector({ url: databaseUrl });
    await connector.connect();
    try {
        const rows = await connector.prisma.$queryRaw<PendingAuctionRow[]>(GamePrisma.sql`
            SELECT
                auction.id AS "auctionId",
                auction.status,
                auction.close_at AS "closeAt",
                auction.detail,
                highest.id AS "highestBidId",
                highest.general_id AS "bidderGeneralId",
                highest.amount,
                highest.meta AS "highestBidMeta"
            FROM auction
            LEFT JOIN LATERAL (
                SELECT bid.id, bid.general_id, bid.amount, bid.meta
                FROM auction_bid bid
                WHERE bid.auction_id = auction.id
                ORDER BY bid.amount DESC, bid.id ASC
                LIMIT 1
            ) highest ON TRUE
            WHERE auction.type = 'UNIQUE_ITEM'
              AND auction.status IN ('OPEN', 'FINALIZING')
            ORDER BY auction.close_at ASC, auction.id ASC
        `);
        return rows.map((row) => {
            const title = asRecord(row.detail).title;
            if (typeof title !== 'string' || !title.trim()) {
                throw new Error(`Unification auction ${row.auctionId} has no title.`);
            }
            const hasBid = row.highestBidId !== null;
            if (hasBid && (row.bidderGeneralId === null || row.amount === null || row.amount <= 0)) {
                throw new Error(`Unification auction ${row.auctionId} has an invalid highest bid.`);
            }
            return {
                auctionId: row.auctionId,
                status: row.status,
                closeAt: new Date(row.closeAt.getTime()),
                title,
                highestBidId: row.highestBidId,
                bidderGeneralId: row.bidderGeneralId,
                amount: row.amount,
                rankTrackedAmount: Math.max(0, Number(asRecord(row.highestBidMeta).inheritSpentTrackedAmount) || 0),
            };
        });
    } finally {
        await connector.disconnect();
    }
};
