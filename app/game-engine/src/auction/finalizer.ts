import { createGamePostgresConnector, GamePrisma } from '@sammo-ts/infra';

import type { TurnDaemonCommandResult } from '../lifecycle/types.js';

export interface AuctionFinalizer {
    finalize(auctionId: number): Promise<TurnDaemonCommandResult>;
    close(): Promise<void>;
}

interface AuctionRow {
    id: number;
    status: string;
}

export const createAuctionFinalizer = async (databaseUrl: string): Promise<AuctionFinalizer> => {
    const connector = createGamePostgresConnector({ url: databaseUrl });
    await connector.connect();
    const prisma = connector.prisma;

    return {
        finalize: async (auctionId: number): Promise<TurnDaemonCommandResult> => {
            const rows = await prisma.$queryRaw<AuctionRow[]>(
                GamePrisma.sql`SELECT id, status FROM auction WHERE id = ${auctionId}`
            );
            const auction = rows[0];
            if (!auction) {
                return {
                    type: 'auctionFinalize',
                    ok: false,
                    auctionId,
                    reason: '경매 정보를 찾을 수 없습니다.',
                };
            }

            if (auction.status === 'FINISHED') {
                return { type: 'auctionFinalize', ok: true, auctionId };
            }

            if (auction.status !== 'FINALIZING') {
                return {
                    type: 'auctionFinalize',
                    ok: false,
                    auctionId,
                    reason: '경매가 확정 대기 상태가 아닙니다.',
                };
            }

            const now = new Date();
            await prisma.$executeRaw(
                GamePrisma.sql`UPDATE auction SET status = 'FINISHED', finished_at = ${now}, updated_at = ${now} WHERE id = ${auctionId}`
            );

            // TODO: 경매 정산(자원 이동, 로그 기록, 유니크 지급)을 월드 상태와 함께 확정해야 한다.

            return { type: 'auctionFinalize', ok: true, auctionId };
        },
        close: async () => {
            await connector.disconnect();
        },
    };
};
