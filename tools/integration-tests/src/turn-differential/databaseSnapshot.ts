import { createGamePostgresConnector } from '@sammo-ts/infra';

import { projectCoreDatabaseSnapshot, type CanonicalTurnSnapshot, type TurnSnapshotSelector } from './canonical.js';

export const readCoreDatabaseSnapshot = async (
    databaseUrl: string,
    selector: TurnSnapshotSelector
): Promise<CanonicalTurnSnapshot> => {
    const connector = createGamePostgresConnector({ url: databaseUrl });
    await connector.connect();
    try {
        const db = connector.prisma;
        const world = await db.worldState.findFirstOrThrow({ orderBy: { id: 'asc' } });
        const [generals, rankData, cities, nations, diplomacy, generalTurns, nationTurns, logs] = await Promise.all([
            db.general.findMany({
                where: { id: { in: selector.generalIds } },
                orderBy: { id: 'asc' },
            }),
            db.rankData.findMany({
                where: { generalId: { in: selector.generalIds } },
                orderBy: [{ generalId: 'asc' }, { type: 'asc' }],
            }),
            db.city.findMany({
                where: { id: { in: selector.cityIds } },
                orderBy: { id: 'asc' },
            }),
            db.nation.findMany({
                where: { id: { in: selector.nationIds } },
                orderBy: { id: 'asc' },
            }),
            db.diplomacy.findMany({
                where: {
                    srcNationId: { in: selector.nationIds },
                    destNationId: { in: selector.nationIds },
                },
                orderBy: [{ srcNationId: 'asc' }, { destNationId: 'asc' }],
            }),
            db.generalTurn.findMany({
                where: { generalId: { in: selector.generalIds } },
                orderBy: [{ generalId: 'asc' }, { turnIdx: 'asc' }],
            }),
            db.nationTurn.findMany({
                where: { nationId: { in: selector.nationIds } },
                orderBy: [{ nationId: 'asc' }, { officerLevel: 'asc' }, { turnIdx: 'asc' }],
            }),
            db.logEntry.findMany({
                where: {
                    id: { gt: selector.logAfterId ?? 0 },
                    OR: [
                        { scope: 'SYSTEM' },
                        { generalId: { in: selector.generalIds } },
                        { nationId: { in: selector.nationIds } },
                    ],
                },
                orderBy: { id: 'asc' },
            }),
        ]);
        return projectCoreDatabaseSnapshot({
            world,
            generals,
            rankData,
            cities,
            nations,
            diplomacy,
            generalTurns,
            nationTurns,
            logs,
        });
    } finally {
        await connector.disconnect();
    }
};
