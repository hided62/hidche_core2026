import { GamePrisma, type GamePrismaClient } from './gamePrisma.js';
import { acquireGameSchemaAdvisoryXactLock } from './gameSchemaAdvisoryLock.js';

export const READ_MODEL_REVISION_COVERAGE_VERSION = 1;

type CoverageDatabase = Pick<GamePrismaClient, '$executeRaw' | '$queryRaw'>;

interface CoverageRow {
    coverageVersion: number;
}

export interface ReadModelCoverageActivationResult {
    previousVersion: number;
    coverageVersion: number;
    seededHeads: number;
}

/**
 * Transaction-bound post-deploy activation. The caller must run this only after
 * every writer for this binary version is deployed. It seeds shared heads
 * without overwriting concurrent increments, then raises the authority gate.
 */
export const activateReadModelRevisionCoverage = async (
    transaction: CoverageDatabase,
    expectedVersion = 0
): Promise<ReadModelCoverageActivationResult> => {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
        throw new RangeError('Expected read-model coverage version must be a non-negative safe integer.');
    }

    await acquireGameSchemaAdvisoryXactLock(
        transaction,
        `read-model-revision-coverage:${READ_MODEL_REVISION_COVERAGE_VERSION}`
    );
    const rows = await transaction.$queryRaw<CoverageRow[]>(GamePrisma.sql`
        SELECT "coverage_version" AS "coverageVersion"
        FROM "read_model_revision_meta"
        WHERE "id" = 1
        FOR UPDATE
    `);
    const current = rows.length === 1 ? rows[0]?.coverageVersion : undefined;
    if (
        !Number.isSafeInteger(current) ||
        (current !== expectedVersion && current !== READ_MODEL_REVISION_COVERAGE_VERSION)
    ) {
        throw new Error(
            `Read-model coverage activation expected ${expectedVersion} or ${READ_MODEL_REVISION_COVERAGE_VERSION}, received ${String(current)}.`
        );
    }

    const seededHeads = await transaction.$executeRaw(GamePrisma.sql`
        INSERT INTO "read_model_revision" ("domain", "entity_id", "revision", "updated_at")
        VALUES
            ('dashboard.global', 0, 1, CURRENT_TIMESTAMP),
            ('map.world', 0, 1, CURRENT_TIMESTAMP)
        ON CONFLICT ("domain", "entity_id") DO NOTHING
    `);
    if (current !== READ_MODEL_REVISION_COVERAGE_VERSION) {
        const updated = await transaction.$executeRaw(GamePrisma.sql`
            UPDATE "read_model_revision_meta"
            SET "coverage_version" = ${READ_MODEL_REVISION_COVERAGE_VERSION}
            WHERE "id" = 1
              AND "coverage_version" = ${expectedVersion}
        `);
        if (updated !== 1) {
            throw new Error('Read-model coverage activation lost its version compare-and-set.');
        }
    }

    return {
        previousVersion: current,
        coverageVersion: READ_MODEL_REVISION_COVERAGE_VERSION,
        seededHeads,
    };
};
