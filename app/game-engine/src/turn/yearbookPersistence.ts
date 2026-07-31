import { createHash } from 'node:crypto';

import type { GamePrisma, InputJsonValue } from '@sammo-ts/infra';
import { LogCategory, LogScope } from '@sammo-ts/logic';

import type { PendingYearbookSnapshot } from './types.js';

const asJson = (value: unknown): InputJsonValue => value as InputJsonValue;

const computeHash = (payload: unknown): string => createHash('sha256').update(JSON.stringify(payload)).digest('hex');

export const persistYearbookSnapshot = async (
    transaction: GamePrisma.TransactionClient,
    snapshot: PendingYearbookSnapshot
): Promise<void> => {
    const [historyRows, actionRows] = await Promise.all([
        transaction.logEntry.findMany({
            where: {
                scope: LogScope.SYSTEM,
                category: LogCategory.HISTORY,
                year: snapshot.year,
                month: snapshot.month,
            },
            orderBy: { id: 'desc' },
            select: { text: true },
        }),
        transaction.logEntry.findMany({
            where: {
                scope: LogScope.SYSTEM,
                category: LogCategory.ACTION,
                year: snapshot.year,
                month: snapshot.month,
            },
            orderBy: { id: 'desc' },
            select: { text: true },
        }),
    ]);
    const globalHistory = historyRows.map((row) => row.text);
    const globalAction = actionRows.map((row) => row.text);
    const hash = computeHash({
        map: snapshot.map,
        nations: snapshot.nations,
        globalHistory,
        globalAction,
    });

    await transaction.yearbookHistory.upsert({
        where: {
            profileName_year_month_sourceId: {
                profileName: snapshot.serverId,
                year: snapshot.year,
                month: snapshot.month,
                sourceId: snapshot.sourceId,
            },
        },
        update: {
            map: asJson(snapshot.map),
            nations: asJson(snapshot.nations),
            globalHistory: asJson(globalHistory),
            globalAction: asJson(globalAction),
            hash,
        },
        create: {
            profileName: snapshot.serverId,
            sourceId: snapshot.sourceId,
            year: snapshot.year,
            month: snapshot.month,
            map: asJson(snapshot.map),
            nations: asJson(snapshot.nations),
            globalHistory: asJson(globalHistory),
            globalAction: asJson(globalAction),
            hash,
        },
    });
};
