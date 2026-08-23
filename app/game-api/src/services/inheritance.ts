import { asNumber, asRecord } from '@sammo-ts/common';
import { GamePrisma } from '@sammo-ts/infra';
import {
    ALL_MERGED_INHERITANCE_KEYS,
    computeActiveInheritancePoint,
} from '@sammo-ts/logic/inheritance/pointCalculation.js';
import type { DatabaseClient, WorldStateRow, InputJsonValue } from '../context.js';

export type InheritPointKey =
    | 'previous'
    | 'lived_month'
    | 'max_domestic_critical'
    | 'active_action'
    | 'combat'
    | 'sabotage'
    | 'dex'
    | 'unifier'
    | 'tournament'
    | 'betting'
    | 'max_belong';

export interface InheritConstants {
    minMonthToAllowInheritItem: number;
    inheritBornSpecialPoint: number;
    inheritBornTurntimePoint: number;
    inheritBornCityPoint: number;
    inheritBornStatPoint: number;
    inheritItemUniqueMinPoint: number;
    inheritItemRandomPoint: number;
    inheritBuffPoints: number[];
    inheritSpecificSpecialPoint: number;
    inheritResetAttrPointBase: number[];
    inheritCheckOwnerPoint: number;
}

const DEFAULT_INHERIT_CONST: InheritConstants = {
    minMonthToAllowInheritItem: 4,
    inheritBornSpecialPoint: 6000,
    inheritBornTurntimePoint: 2500,
    inheritBornCityPoint: 1000,
    inheritBornStatPoint: 1000,
    inheritItemUniqueMinPoint: 5000,
    inheritItemRandomPoint: 3000,
    inheritBuffPoints: [0, 200, 600, 1200, 2000, 3000],
    inheritSpecificSpecialPoint: 4000,
    inheritResetAttrPointBase: [1000, 1000, 2000, 3000],
    inheritCheckOwnerPoint: 1000,
};

const resolveNumberArray = (value: unknown, fallback: number[]): number[] => {
    if (!Array.isArray(value)) {
        return fallback;
    }
    const filtered = value
        .map((item) => (typeof item === 'number' && Number.isFinite(item) ? item : null))
        .filter((item): item is number => item !== null);
    return filtered.length > 0 ? filtered : fallback;
};

export const resolveInheritConstants = (worldState: WorldStateRow): InheritConstants => {
    const config = asRecord(worldState.config);
    const configConst = asRecord(config.const);

    return {
        minMonthToAllowInheritItem: asNumber(
            configConst.minMonthToAllowInheritItem,
            DEFAULT_INHERIT_CONST.minMonthToAllowInheritItem
        ),
        inheritBornSpecialPoint: asNumber(
            configConst.inheritBornSpecialPoint,
            DEFAULT_INHERIT_CONST.inheritBornSpecialPoint
        ),
        inheritBornTurntimePoint: asNumber(
            configConst.inheritBornTurntimePoint,
            DEFAULT_INHERIT_CONST.inheritBornTurntimePoint
        ),
        inheritBornCityPoint: asNumber(configConst.inheritBornCityPoint, DEFAULT_INHERIT_CONST.inheritBornCityPoint),
        inheritBornStatPoint: asNumber(configConst.inheritBornStatPoint, DEFAULT_INHERIT_CONST.inheritBornStatPoint),
        inheritItemUniqueMinPoint: asNumber(
            configConst.inheritItemUniqueMinPoint,
            DEFAULT_INHERIT_CONST.inheritItemUniqueMinPoint
        ),
        inheritItemRandomPoint: asNumber(
            configConst.inheritItemRandomPoint,
            DEFAULT_INHERIT_CONST.inheritItemRandomPoint
        ),
        inheritBuffPoints: resolveNumberArray(configConst.inheritBuffPoints, DEFAULT_INHERIT_CONST.inheritBuffPoints),
        inheritSpecificSpecialPoint: asNumber(
            configConst.inheritSpecificSpecialPoint,
            DEFAULT_INHERIT_CONST.inheritSpecificSpecialPoint
        ),
        inheritResetAttrPointBase: resolveNumberArray(
            configConst.inheritResetAttrPointBase,
            DEFAULT_INHERIT_CONST.inheritResetAttrPointBase
        ),
        inheritCheckOwnerPoint: asNumber(
            configConst.inheritCheckOwnerPoint,
            DEFAULT_INHERIT_CONST.inheritCheckOwnerPoint
        ),
    };
};

export const buildResetCost = (baseCosts: number[], level: number): number => {
    const costs = [...baseCosts];
    while (costs.length <= level) {
        const size = costs.length;
        const next = (costs[size - 1] ?? 0) + (costs[size - 2] ?? 0);
        costs.push(next);
    }
    return costs[level] ?? 0;
};

export const readInheritancePoint = async (
    db: DatabaseClient,
    userId: string,
    key: InheritPointKey
): Promise<number> => {
    const rows = await db.$queryRaw<Array<{ value: number }>>(
        GamePrisma.sql`
            SELECT value
            FROM inheritance_point
            WHERE user_id = ${userId} AND key = ${key}
            FOR UPDATE
        `
    );
    return rows[0]?.value ?? 0;
};

export const setInheritancePoint = async (
    db: DatabaseClient,
    userId: string,
    key: InheritPointKey,
    value: number
): Promise<void> => {
    await db.inheritancePoint.upsert({
        where: {
            userId_key: {
                userId,
                key,
            },
        },
        update: {
            value,
        },
        create: {
            userId,
            key,
            value,
        },
    });
};

export const appendInheritanceLog = async (
    db: DatabaseClient,
    userId: string,
    year: number,
    month: number,
    text: string
): Promise<void> => {
    await db.inheritanceLog.create({
        data: {
            userId,
            year,
            month,
            text,
        },
    });
};

export const computeInheritanceItems = async (options: {
    db: DatabaseClient;
    userId: string;
    generalMeta: Record<string, unknown> | null;
    isUnited: boolean;
}): Promise<Record<InheritPointKey, number>> => {
    const pointRows = await options.db.inheritancePoint.findMany({
        where: { userId: options.userId },
        select: { key: true, value: true },
    });
    const inheritancePoints = Object.fromEntries(pointRows.map((row) => [row.key, row.value]));
    const previous = inheritancePoints.previous ?? 0;
    const general = {
        meta: options.generalMeta ?? {},
        inheritancePoints,
    };

    if (options.isUnited) {
        return Object.fromEntries([
            ['previous', previous],
            ...ALL_MERGED_INHERITANCE_KEYS.map((key) => [key, inheritancePoints[key] ?? 0] as const),
        ]) as Record<InheritPointKey, number>;
    }

    return Object.fromEntries([
        ['previous', previous],
        ...ALL_MERGED_INHERITANCE_KEYS.map((key) => [key, computeActiveInheritancePoint(general, key)] as const),
    ]) as Record<InheritPointKey, number>;
};

export const sumInheritanceItems = (items: Record<InheritPointKey, number>): number => {
    return Object.entries(items).reduce(
        (acc, [key, value]) => (key === 'previous' ? acc : acc + value),
        items.previous
    );
};

export const readUserStateMeta = async (db: DatabaseClient, userId: string): Promise<Record<string, unknown>> => {
    const row = await db.inheritanceUserState.findUnique({
        where: { userId },
        select: { meta: true },
    });
    return asRecord(row?.meta);
};

export const writeUserStateMeta = async (
    db: DatabaseClient,
    userId: string,
    meta: Record<string, unknown>
): Promise<void> => {
    const jsonMeta = meta as InputJsonValue;
    await db.inheritanceUserState.upsert({
        where: { userId },
        update: { meta: jsonMeta },
        create: { userId, meta: jsonMeta },
    });
};
