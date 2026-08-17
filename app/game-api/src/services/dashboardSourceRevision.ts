import { createHash } from 'node:crypto';

import { GamePrisma } from '@sammo-ts/infra';

import type { DatabaseClient } from '../context.js';

/**
 * Reserved target version for the revision-first protocol tests. Do not set the
 * database coverage meta to this value until every transitive context/command
 * dependency and producer has been reconciled; migrations/runtime remain at 0.
 */
export const DASHBOARD_SOURCE_REVISION_COVERAGE_VERSION = 1;

const SOURCE_REVISION_LENGTH = 22;
const SOURCE_REVISION_CODE_VERSION = 'dashboard-private-slices-v3';

export type DashboardSourceSlice = 'context' | 'commandTable' | 'boardAccess';

export interface DashboardSourceRevisionState {
    coverageVersion: number;
    identity: {
        generalId: number;
        cityId: number;
        nationId: number;
    };
    sourceRevisions: Record<DashboardSourceSlice, string>;
}

interface DashboardSourceRevisionRow {
    generalId: number;
    cityId: number;
    nationId: number;
    coverageVersion: number;
    globalRevision: bigint;
    generalRevision: bigint;
    cityRevision: bigint;
    nationRevision: bigint;
    worldRevision: bigint;
}

type RevisionTuple = readonly [domain: string, entityId: number, revision: string];
type DashboardRevisionVector = {
    global: string;
    general: string;
    city: string;
    nation: string;
    world: string;
};

export interface DashboardAuthSource {
    iconUpdatedAt?: string;
    profileIconResetAt?: string;
    canUseGeneralPicture?: boolean;
    icons?: readonly {
        id: string;
        picture: string;
        imageServer: number;
        createdAt: string;
    }[];
}
type ParsedDashboardRevisionVector = {
    [Key in keyof DashboardRevisionVector]: DashboardRevisionVector[Key] | null;
};

const parseNonNegativeInteger = (value: unknown): number | null => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        return null;
    }
    return value;
};

const parseNonNegativeRevision = (value: unknown): string | null => {
    if (typeof value === 'bigint') {
        return value >= 0n ? value.toString() : null;
    }
    if (typeof value === 'number') {
        return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
    }
    if (typeof value === 'string' && /^(?:0|[1-9]\d*)$/u.test(value)) {
        return value;
    }
    return null;
};

const digestSourceRevision = (slice: DashboardSourceSlice, dependencies: readonly RevisionTuple[]): string =>
    createHash('sha256')
        .update(JSON.stringify([SOURCE_REVISION_CODE_VERSION, slice, dependencies]))
        .digest('base64url')
        .slice(0, SOURCE_REVISION_LENGTH);

export const createDashboardAuthSourceRevision = (source: DashboardAuthSource | undefined): string =>
    createHash('sha256')
        .update(
            JSON.stringify([
                SOURCE_REVISION_CODE_VERSION,
                'auth.context',
                source?.canUseGeneralPicture !== false,
                source?.iconUpdatedAt ?? null,
                source?.profileIconResetAt ?? null,
                (source?.icons ?? []).map(({ id, picture, imageServer, createdAt }) => [
                    id,
                    picture,
                    imageServer,
                    createdAt,
                ]),
            ])
        )
        .digest('base64url')
        .slice(0, SOURCE_REVISION_LENGTH);

const isCompleteRevisionVector = (
    revisions: ParsedDashboardRevisionVector
): revisions is DashboardRevisionVector => Object.values(revisions).every((revision) => revision !== null);

const buildSourceRevisions = (
    identity: DashboardSourceRevisionState['identity'],
    revisions: DashboardRevisionVector,
    authSourceRevision: string
): Record<DashboardSourceSlice, string> => {
    const global = ['dashboard.global', 0, revisions.global] as const;
    const general = ['general.content', identity.generalId, revisions.general] as const;
    const city = ['city.content', identity.cityId, identity.cityId > 0 ? revisions.city : '0'] as const;
    const nation = ['nation.content', identity.nationId, identity.nationId > 0 ? revisions.nation : '0'] as const;
    const world = ['world.content', 0, revisions.world] as const;
    const auth = ['auth.context', 0, authSourceRevision] as const;

    return {
        context: digestSourceRevision('context', [global, general, city, nation, world, auth]),
        commandTable: digestSourceRevision('commandTable', [global, general, city, nation, world]),
        boardAccess: digestSourceRevision('boardAccess', [general, nation]),
    };
};

/**
 * Reads the access-gate actor identity, coverage gate, and all dashboard-private
 * dependency heads in one indexed statement. Missing revision rows are revision 0.
 * A missing actor/meta row, query failure, or malformed result disables the optimization.
 */
const readDashboardSourceRevisionStateByActor = async (
    db: Pick<DatabaseClient, '$queryRaw'>,
    actorCondition: GamePrisma.Sql,
    authSource?: DashboardAuthSource
): Promise<DashboardSourceRevisionState | null> => {
    let rows: DashboardSourceRevisionRow[];
    try {
        rows = await db.$queryRaw<DashboardSourceRevisionRow[]>(GamePrisma.sql`
            SELECT
                actor."id" AS "generalId",
                actor."city_id" AS "cityId",
                actor."nation_id" AS "nationId",
                meta."coverage_version" AS "coverageVersion",
                COALESCE(global_revision."revision", 0) AS "globalRevision",
                COALESCE(general_revision."revision", 0) AS "generalRevision",
                COALESCE(city_revision."revision", 0) AS "cityRevision",
                COALESCE(nation_revision."revision", 0) AS "nationRevision",
                COALESCE(world_revision."revision", 0) AS "worldRevision"
            FROM "general" AS actor
            CROSS JOIN "read_model_revision_meta" AS meta
            LEFT JOIN "read_model_revision" AS global_revision
                ON global_revision."domain" = 'dashboard.global'
               AND global_revision."entity_id" = 0
            LEFT JOIN "read_model_revision" AS general_revision
                ON general_revision."domain" = 'general.content'
               AND general_revision."entity_id" = actor."id"
            LEFT JOIN "read_model_revision" AS city_revision
                ON city_revision."domain" = 'city.content'
               AND city_revision."entity_id" = actor."city_id"
            LEFT JOIN "read_model_revision" AS nation_revision
                ON nation_revision."domain" = 'nation.content'
               AND nation_revision."entity_id" = actor."nation_id"
            LEFT JOIN "read_model_revision" AS world_revision
                ON world_revision."domain" = 'world.content'
               AND world_revision."entity_id" = 0
            WHERE ${actorCondition}
              AND meta."id" = 1
        `);
    } catch {
        return null;
    }

    const row = rows.length === 1 ? rows[0] : undefined;
    if (!row) {
        return null;
    }

    const identity = {
        generalId: parseNonNegativeInteger(row.generalId),
        cityId: parseNonNegativeInteger(row.cityId),
        nationId: parseNonNegativeInteger(row.nationId),
    };
    const coverageVersion = parseNonNegativeInteger(row.coverageVersion);
    const revisions = {
        global: parseNonNegativeRevision(row.globalRevision),
        general: parseNonNegativeRevision(row.generalRevision),
        city: parseNonNegativeRevision(row.cityRevision),
        nation: parseNonNegativeRevision(row.nationRevision),
        world: parseNonNegativeRevision(row.worldRevision),
    };
    if (
        identity.generalId === null ||
        identity.cityId === null ||
        identity.nationId === null ||
        coverageVersion === null ||
        !isCompleteRevisionVector(revisions)
    ) {
        return null;
    }

    const validIdentity = {
        generalId: identity.generalId,
        cityId: identity.cityId,
        nationId: identity.nationId,
    };
    return {
        coverageVersion,
        identity: validIdentity,
        sourceRevisions: buildSourceRevisions(
            validIdentity,
            revisions,
            createDashboardAuthSourceRevision(authSource)
        ),
    };
};

export const readDashboardSourceRevisionState = async (
    db: Pick<DatabaseClient, '$queryRaw'>,
    generalId: number,
    authSource?: DashboardAuthSource
): Promise<DashboardSourceRevisionState | null> => {
    if (!Number.isSafeInteger(generalId) || generalId <= 0) {
        return null;
    }
    return readDashboardSourceRevisionStateByActor(db, GamePrisma.sql`actor."id" = ${generalId}`, authSource);
};

export const readDashboardSourceRevisionStateForUser = async (
    db: Pick<DatabaseClient, '$queryRaw'>,
    userId: string,
    authSource?: DashboardAuthSource
): Promise<DashboardSourceRevisionState | null> => {
    if (!userId) {
        return null;
    }
    return readDashboardSourceRevisionStateByActor(db, GamePrisma.sql`actor."user_id" = ${userId}`, authSource);
};

export const canUseDashboardSourceRevision = (options: {
    state: DashboardSourceRevisionState | null;
    slice: DashboardSourceSlice;
    knownContent?: string;
    knownSource?: string;
    forceSnapshot?: boolean;
}): boolean =>
    options.forceSnapshot !== true &&
    options.state !== null &&
    options.state.coverageVersion >= DASHBOARD_SOURCE_REVISION_COVERAGE_VERSION &&
    options.knownContent !== undefined &&
    options.knownSource !== undefined &&
    options.knownSource === options.state.sourceRevisions[options.slice];
