import type { DatabaseClient } from '@sammo-ts/infra';

/** 통일 대기/이민족전으로 시계가 재개되어도 확정된 기수의 기록은 다시 열지 않는다. */
export const areSeasonRecordsFinalized = async (
    db: Pick<DatabaseClient, 'gameHistory'>,
    serverId: unknown
): Promise<boolean> => {
    if (typeof serverId !== 'string' || !serverId.trim()) return false;
    const history = await db.gameHistory.findUnique({
        where: { serverId: serverId.trim() },
        select: { status: true },
    });
    return history?.status === 'COMPLETED';
};
