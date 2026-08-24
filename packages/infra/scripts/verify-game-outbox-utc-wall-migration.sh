#!/bin/sh
set -eu

: "${GAME_OUTBOX_MIGRATION_TEST_DATABASE_URL:?GAME_OUTBOX_MIGRATION_TEST_DATABASE_URL is required}"

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
package_dir=$(dirname "$script_dir")
prisma_dir="$package_dir/prisma"
target_migration=20260824070000_game_outbox_utc_wall_timestamps
run_id=$(date -u +%m%d%H%M%S)_$$
schema_name="game_outbox_utc_upgrade_$run_id"
ownership_token="sammo-game-outbox-utc-migration:$run_id"
work_dir=$(mktemp -d "$package_dir/.game-outbox-utc-migration.XXXXXX")

case "$schema_name" in
    game_outbox_utc_upgrade_[0-9]*_[0-9]*) ;;
    *)
        echo "unsafe outbox migration schema name" >&2
        exit 64
        ;;
esac

cleanup() {
    cleanup_status=0
    OWNERSHIP_TOKEN=$ownership_token \
        SCHEMA_NAME=$schema_name \
        DATABASE_URL=$GAME_OUTBOX_MIGRATION_TEST_DATABASE_URL \
        pnpm --dir "$package_dir" exec node --input-type=module -e '
            import pg from "pg";
            const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
            const quoteIdentifier = (value) => `"${value.replaceAll("\"", "\"\"")}"`;
            await client.connect();
            try {
                const ownership = await client.query(
                    "SELECT obj_description(oid, $$pg_namespace$$) AS owner FROM pg_namespace WHERE nspname = $1",
                    [process.env.SCHEMA_NAME]
                );
                if (ownership.rowCount > 0) {
                    if (ownership.rows[0]?.owner !== process.env.OWNERSHIP_TOKEN) {
                        throw new Error(`refusing to drop unowned schema: ${process.env.SCHEMA_NAME}`);
                    }
                    await client.query(`DROP SCHEMA ${quoteIdentifier(process.env.SCHEMA_NAME)} CASCADE`);
                }
            } finally {
                await client.end();
            }
        ' >/dev/null 2>&1 || cleanup_status=1
    case "$work_dir" in
        "$package_dir"/.game-outbox-utc-migration.*)
            rm -r -- "$work_dir" || cleanup_status=1
            ;;
        *)
            echo "refusing to remove unsafe outbox migration work directory: $work_dir" >&2
            cleanup_status=1
            ;;
    esac
    return "$cleanup_status"
}

handle_exit() {
    exit_status=$?
    trap - EXIT HUP INT TERM
    if ! cleanup && [ "$exit_status" -eq 0 ]; then
        exit_status=1
    fi
    exit "$exit_status"
}

trap handle_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

[ -d "$prisma_dir/migrations/$target_migration" ] || {
    echo "target migration is missing: $target_migration" >&2
    exit 66
}

build_database_url() {
    SCHEMA_NAME=$schema_name DATABASE_URL=$GAME_OUTBOX_MIGRATION_TEST_DATABASE_URL \
        pnpm --dir "$package_dir" exec node --input-type=module -e '
            const url = new URL(process.env.DATABASE_URL);
            url.searchParams.set("schema", process.env.SCHEMA_NAME);
            // The migration must reinterpret the predecessor DB-default timestamps
            // from the real legacy KST session contract, independently of host TZ.
            url.searchParams.set("options", "-c TimeZone=Asia/Seoul");
            process.stdout.write(url.href);
        '
}

database_url=$(build_database_url)

OWNERSHIP_TOKEN=$ownership_token \
    SCHEMA_NAME=$schema_name \
    DATABASE_URL=$GAME_OUTBOX_MIGRATION_TEST_DATABASE_URL \
    pnpm --dir "$package_dir" exec node --input-type=module -e '
        import pg from "pg";
        const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
        const quoteIdentifier = (value) => `"${value.replaceAll("\"", "\"\"")}"`;
        const apostrophe = String.fromCharCode(39);
        const quoteLiteral = (value) =>
            `${apostrophe}${value.replaceAll(apostrophe, apostrophe.repeat(2))}${apostrophe}`;
        await client.connect();
        try {
            await client.query("BEGIN");
            await client.query(`CREATE SCHEMA ${quoteIdentifier(process.env.SCHEMA_NAME)}`);
            await client.query(
                `COMMENT ON SCHEMA ${quoteIdentifier(process.env.SCHEMA_NAME)} IS ${quoteLiteral(
                    process.env.OWNERSHIP_TOKEN
                )}`
            );
            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            await client.end();
        }
    '

stage_prisma="$work_dir/prisma"
mkdir -p "$stage_prisma/migrations"
cp "$prisma_dir/game.prisma" "$stage_prisma/game.prisma"
found_target=0
for migration_dir in "$prisma_dir"/migrations/[0-9]*; do
    migration_name=$(basename "$migration_dir")
    if [ "$migration_name" = "$target_migration" ]; then
        found_target=1
        break
    fi
    cp -R "$migration_dir" "$stage_prisma/migrations/$migration_name"
done
[ "$found_target" -eq 1 ] || {
    echo "target migration was not found in migration order" >&2
    exit 1
}

cd "$package_dir"
if ! DATABASE_URL=$database_url PRISMA_SCHEMA="$stage_prisma/game.prisma" \
    pnpm exec prisma migrate deploy --schema "$stage_prisma/game.prisma" \
        >"$work_dir/predecessor-deploy.log" 2>&1; then
    echo "failed to deploy the predecessor game migration chain" >&2
    exit 1
fi

SCHEMA_NAME=$schema_name DATABASE_URL=$database_url \
    pnpm exec node --input-type=module -e '
        import pg from "pg";
        const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
        const quoteIdentifier = (value) => `"${value.replaceAll("\"", "\"\"")}"`;
        await client.connect();
        try {
            const timezone = await client.query("SHOW TimeZone");
            if (timezone.rows[0]?.TimeZone !== "Asia/Seoul") {
                throw new Error(`expected Asia/Seoul fixture session, received ${timezone.rows[0]?.TimeZone}`);
            }
            await client.query(`SET search_path TO ${quoteIdentifier(process.env.SCHEMA_NAME)}`);
            await client.query("BEGIN");
            await client.query(`
                CREATE TABLE "_game_outbox_utc_upgrade_probe" (
                    "id" INTEGER PRIMARY KEY,
                    "before_utc" TIMESTAMP(3) NOT NULL,
                    "read_pending_created_before" TIMESTAMP(3)
                )
            `);
            await client.query(`
                INSERT INTO "_game_outbox_utc_upgrade_probe" ("id", "before_utc")
                VALUES (1, CURRENT_TIMESTAMP AT TIME ZONE $$UTC$$)
            `);
            await client.query(`
                INSERT INTO "read_model_outbox" (
                    "id", "payload", "attempts", "available_at", "locked_at",
                    "lock_owner", "delivered_at", "last_error", "created_at"
                ) VALUES
                    (
                        910001,
                        $json$ {"version":1,"changes":[["general",101,"2"]],"fixture":"read-pending"} $json$::jsonb,
                        2,
                        TIMESTAMP $$2030-01-02 03:04:05.111$$,
                        TIMESTAMP $$2026-08-24 16:01:02.222$$,
                        $$legacy-read-worker$$,
                        NULL,
                        $$read retry$$,
                        DEFAULT
                    ),
                    (
                        910002,
                        $json$ {"version":1,"changes":[["nation",7,"3"]],"fixture":"read-delivered"} $json$::jsonb,
                        3,
                        TIMESTAMP $$2026-08-24 15:00:00.333$$,
                        TIMESTAMP $$2026-08-24 15:01:00.444$$,
                        $$delivered-read-worker$$,
                        TIMESTAMP $$2026-08-24 15:02:00.555$$,
                        $$delivered read marker$$,
                        TIMESTAMP $$2026-08-24 16:10:00.789$$
                    )
            `);
            await client.query(`
                INSERT INTO "web_push_outbox" (
                    "id", "event_id", "event_type", "user_ids", "year", "month",
                    "attempts", "available_at", "locked_at", "lock_owner",
                    "delivered_at", "last_error", "created_at"
                ) VALUES
                    (
                        920001,
                        $$upgrade-web-pending$$,
                        $$PRIVATE_MESSAGE_RECEIVED$$,
                        ARRAY[$$user-b$$, $$user-a$$],
                        201,
                        7,
                        4,
                        TIMESTAMP $$2030-02-03 04:05:06.222$$,
                        TIMESTAMP $$2026-08-24 07:02:03.333$$,
                        $$legacy-web-worker$$,
                        NULL,
                        $$web retry$$,
                        TIMESTAMP $$2026-08-24 07:00:00.456$$
                    ),
                    (
                        920002,
                        $$upgrade-web-delivered$$,
                        $$MONTH_CHANGED$$,
                        ARRAY[$$user-c$$],
                        202,
                        8,
                        5,
                        TIMESTAMP $$2026-08-24 07:10:00.333$$,
                        TIMESTAMP $$2026-08-24 07:11:00.444$$,
                        $$delivered-web-worker$$,
                        TIMESTAMP $$2026-08-24 07:12:00.555$$,
                        $$delivered web marker$$,
                        TIMESTAMP $$2026-08-24 07:09:00.789$$
                    )
            `);
            await client.query(`
                UPDATE "_game_outbox_utc_upgrade_probe"
                SET "read_pending_created_before" = (
                    SELECT "created_at" FROM "read_model_outbox" WHERE "id" = 910001
                )
                WHERE "id" = 1
            `);
            const readProvenance = await client.query(`
                SELECT read."created_at" = probe."before_utc" + INTERVAL $$9 hours$$ AS "isKstDefault"
                FROM "read_model_outbox" read
                CROSS JOIN "_game_outbox_utc_upgrade_probe" probe
                WHERE read."id" = 910001
            `);
            if (readProvenance.rows[0]?.isKstDefault !== true) {
                throw new Error("predecessor read-model created_at did not use the KST database default");
            }
            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            await client.end();
        }
    '

if ! DATABASE_URL=$database_url PRISMA_SCHEMA="$prisma_dir/game.prisma" \
    pnpm exec prisma migrate deploy --schema "$prisma_dir/game.prisma" \
        >"$work_dir/incremental-deploy.log" 2>&1; then
    echo "failed to deploy the outbox UTC-wall migration" >&2
    exit 1
fi

SCHEMA_NAME=$schema_name \
    TARGET_MIGRATION=$target_migration \
    MIGRATION_FILE="$prisma_dir/migrations/$target_migration/migration.sql" \
    DATABASE_URL=$database_url \
    pnpm exec node --input-type=module -e '
        import { createHash } from "node:crypto";
        import { readFile } from "node:fs/promises";
        import pg from "pg";

        const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
        const quoteIdentifier = (value) => `"${value.replaceAll("\"", "\"\"")}"`;
        const canonicalize = (value) => {
            if (Array.isArray(value)) return value.map(canonicalize);
            if (value && typeof value === "object") {
                return Object.fromEntries(
                    Object.entries(value)
                        .sort(([left], [right]) => left.localeCompare(right))
                        .map(([key, entry]) => [key, canonicalize(entry)])
                );
            }
            return value;
        };
        const assertEqual = (actual, expected, label) => {
            if (JSON.stringify(canonicalize(actual)) !== JSON.stringify(canonicalize(expected))) {
                throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
            }
        };

        await client.connect();
        try {
            await client.query(`SET search_path TO ${quoteIdentifier(process.env.SCHEMA_NAME)}`);

            const readRows = await client.query(`
                SELECT
                    "read_model_outbox"."id"::int AS "id",
                    "payload",
                    "attempts",
                    to_char("available_at", $$YYYY-MM-DD HH24:MI:SS.MS$$) AS "availableAt",
                    CASE WHEN "locked_at" IS NULL THEN NULL
                         ELSE to_char("locked_at", $$YYYY-MM-DD HH24:MI:SS.MS$$) END AS "lockedAt",
                    "lock_owner" AS "lockOwner",
                    CASE WHEN "delivered_at" IS NULL THEN NULL
                         ELSE to_char("delivered_at", $$YYYY-MM-DD HH24:MI:SS.MS$$) END AS "deliveredAt",
                    "last_error" AS "lastError",
                    to_char("created_at", $$YYYY-MM-DD HH24:MI:SS.MS$$) AS "createdAt",
                    "created_at" = (
                        probe."read_pending_created_before" AT TIME ZONE $$Asia/Seoul$$
                    ) AT TIME ZONE $$UTC$$ AS "createdNormalized",
                    "available_at" >= probe."before_utc" - INTERVAL $$1 second$$
                        AND "available_at" <= (CURRENT_TIMESTAMP AT TIME ZONE $$UTC$$) + INTERVAL $$1 second$$
                        AS "availableInMigrationWindow"
                FROM "read_model_outbox"
                CROSS JOIN "_game_outbox_utc_upgrade_probe" probe
                WHERE "read_model_outbox"."id" IN (910001, 910002)
                ORDER BY "read_model_outbox"."id"
            `);
            const [readPending, readDelivered] = readRows.rows;
            if (!readPending || !readDelivered) throw new Error("read-model upgrade fixtures are missing");
            assertEqual(
                {
                    id: readPending.id,
                    payload: readPending.payload,
                    attempts: readPending.attempts,
                    lockedAt: readPending.lockedAt,
                    lockOwner: readPending.lockOwner,
                    deliveredAt: readPending.deliveredAt,
                    lastError: readPending.lastError,
                    createdNormalized: readPending.createdNormalized,
                    availableInMigrationWindow: readPending.availableInMigrationWindow,
                },
                {
                    id: 910001,
                    payload: { version: 1, changes: [["general", 101, "2"]], fixture: "read-pending" },
                    attempts: 2,
                    lockedAt: null,
                    lockOwner: null,
                    deliveredAt: null,
                    lastError: "read retry",
                    createdNormalized: true,
                    availableInMigrationWindow: true,
                },
                "pending read-model row"
            );
            assertEqual(
                {
                    id: readDelivered.id,
                    payload: readDelivered.payload,
                    attempts: readDelivered.attempts,
                    availableAt: readDelivered.availableAt,
                    lockedAt: readDelivered.lockedAt,
                    lockOwner: readDelivered.lockOwner,
                    deliveredAt: readDelivered.deliveredAt,
                    lastError: readDelivered.lastError,
                    createdAt: readDelivered.createdAt,
                },
                {
                    id: 910002,
                    payload: { version: 1, changes: [["nation", 7, "3"]], fixture: "read-delivered" },
                    attempts: 3,
                    availableAt: "2026-08-24 15:00:00.333",
                    lockedAt: "2026-08-24 15:01:00.444",
                    lockOwner: "delivered-read-worker",
                    deliveredAt: "2026-08-24 15:02:00.555",
                    lastError: "delivered read marker",
                    createdAt: "2026-08-24 07:10:00.789",
                },
                "delivered read-model row"
            );

            const webRows = await client.query(`
                SELECT
                    "web_push_outbox"."id"::int AS "id",
                    "event_id" AS "eventId",
                    "event_type" AS "eventType",
                    "user_ids" AS "userIds",
                    "year",
                    "month",
                    "attempts",
                    to_char("available_at", $$YYYY-MM-DD HH24:MI:SS.MS$$) AS "availableAt",
                    CASE WHEN "locked_at" IS NULL THEN NULL
                         ELSE to_char("locked_at", $$YYYY-MM-DD HH24:MI:SS.MS$$) END AS "lockedAt",
                    "lock_owner" AS "lockOwner",
                    CASE WHEN "delivered_at" IS NULL THEN NULL
                         ELSE to_char("delivered_at", $$YYYY-MM-DD HH24:MI:SS.MS$$) END AS "deliveredAt",
                    "last_error" AS "lastError",
                    to_char("created_at", $$YYYY-MM-DD HH24:MI:SS.MS$$) AS "createdAt",
                    "available_at" >= probe."before_utc" - INTERVAL $$1 second$$
                        AND "available_at" <= (CURRENT_TIMESTAMP AT TIME ZONE $$UTC$$) + INTERVAL $$1 second$$
                        AS "availableInMigrationWindow"
                FROM "web_push_outbox"
                CROSS JOIN "_game_outbox_utc_upgrade_probe" probe
                WHERE "web_push_outbox"."id" IN (920001, 920002)
                ORDER BY "web_push_outbox"."id"
            `);
            const [webPending, webDelivered] = webRows.rows;
            if (!webPending || !webDelivered) throw new Error("web-push upgrade fixtures are missing");
            assertEqual(
                {
                    id: webPending.id,
                    eventId: webPending.eventId,
                    eventType: webPending.eventType,
                    userIds: webPending.userIds,
                    year: webPending.year,
                    month: webPending.month,
                    attempts: webPending.attempts,
                    lockedAt: webPending.lockedAt,
                    lockOwner: webPending.lockOwner,
                    deliveredAt: webPending.deliveredAt,
                    lastError: webPending.lastError,
                    createdAt: webPending.createdAt,
                    availableInMigrationWindow: webPending.availableInMigrationWindow,
                },
                {
                    id: 920001,
                    eventId: "upgrade-web-pending",
                    eventType: "PRIVATE_MESSAGE_RECEIVED",
                    userIds: ["user-b", "user-a"],
                    year: 201,
                    month: 7,
                    attempts: 4,
                    lockedAt: null,
                    lockOwner: null,
                    deliveredAt: null,
                    lastError: "web retry",
                    createdAt: "2026-08-24 07:00:00.456",
                    availableInMigrationWindow: true,
                },
                "pending web-push row"
            );
            assertEqual(
                {
                    id: webDelivered.id,
                    eventId: webDelivered.eventId,
                    eventType: webDelivered.eventType,
                    userIds: webDelivered.userIds,
                    year: webDelivered.year,
                    month: webDelivered.month,
                    attempts: webDelivered.attempts,
                    availableAt: webDelivered.availableAt,
                    lockedAt: webDelivered.lockedAt,
                    lockOwner: webDelivered.lockOwner,
                    deliveredAt: webDelivered.deliveredAt,
                    lastError: webDelivered.lastError,
                    createdAt: webDelivered.createdAt,
                },
                {
                    id: 920002,
                    eventId: "upgrade-web-delivered",
                    eventType: "MONTH_CHANGED",
                    userIds: ["user-c"],
                    year: 202,
                    month: 8,
                    attempts: 5,
                    availableAt: "2026-08-24 07:10:00.333",
                    lockedAt: "2026-08-24 07:11:00.444",
                    lockOwner: "delivered-web-worker",
                    deliveredAt: "2026-08-24 07:12:00.555",
                    lastError: "delivered web marker",
                    createdAt: "2026-08-24 07:09:00.789",
                },
                "delivered web-push row"
            );

            const columns = await client.query(`
                SELECT table_name AS "tableName", column_name AS "columnName",
                       data_type AS "dataType", datetime_precision AS "precision"
                FROM information_schema.columns
                WHERE table_schema = $1
                  AND table_name IN ($$read_model_outbox$$, $$web_push_outbox$$)
                  AND column_name IN ($$available_at$$, $$locked_at$$, $$delivered_at$$, $$created_at$$)
                ORDER BY table_name, column_name
            `, [process.env.SCHEMA_NAME]);
            if (columns.rowCount !== 8) throw new Error(`expected eight outbox timestamp columns, received ${columns.rowCount}`);
            for (const column of columns.rows) {
                if (column.dataType !== "timestamp without time zone" || column.precision !== 3) {
                    throw new Error(`rollback-incompatible timestamp column: ${JSON.stringify(column)}`);
                }
            }

            const expectedChecksum = createHash("sha256")
                .update(await readFile(process.env.MIGRATION_FILE))
                .digest("hex");
            const history = await client.query(`
                SELECT checksum, finished_at IS NOT NULL AS finished,
                       rolled_back_at IS NULL AS "notRolledBack", applied_steps_count AS steps
                FROM "_prisma_migrations"
                WHERE migration_name = $1
            `, [process.env.TARGET_MIGRATION]);
            assertEqual(history.rows, [{ checksum: expectedChecksum, finished: true, notRolledBack: true, steps: 1 }], "migration history");

            // This is the rollback-compatibility boundary: the predecessor runtime
            // DML shapes and TIMESTAMP(3) mappings remain accepted. It deliberately
            // does not claim a down migration or execute a separately built old binary.
            const rollbackProbe = await client.query(`
                WITH inserted_read AS (
                    INSERT INTO "read_model_outbox" ("payload")
                    VALUES ($json$ {"version":1,"changes":[],"fixture":"old-read-shape"} $json$::jsonb)
                    RETURNING "created_at", "available_at"
                ), inserted_web AS (
                    INSERT INTO "web_push_outbox" (
                        "event_id", "event_type", "user_ids", "available_at", "created_at"
                    ) VALUES (
                        $$upgrade-old-web-shape$$,
                        $$PRIVATE_MESSAGE_RECEIVED$$,
                        ARRAY[]::TEXT[],
                        CURRENT_TIMESTAMP AT TIME ZONE $$UTC$$,
                        CURRENT_TIMESTAMP AT TIME ZONE $$UTC$$
                    )
                    RETURNING "created_at", "available_at"
                )
                SELECT
                    inserted_read."created_at" BETWEEN
                        (CURRENT_TIMESTAMP AT TIME ZONE $$UTC$$) - INTERVAL $$1 second$$ AND
                        (CURRENT_TIMESTAMP AT TIME ZONE $$UTC$$) + INTERVAL $$1 second$$ AS "readCreatedUtc",
                    inserted_read."available_at" BETWEEN
                        (CURRENT_TIMESTAMP AT TIME ZONE $$UTC$$) - INTERVAL $$1 second$$ AND
                        (CURRENT_TIMESTAMP AT TIME ZONE $$UTC$$) + INTERVAL $$1 second$$ AS "readAvailableUtc",
                    inserted_web."created_at" BETWEEN
                        (CURRENT_TIMESTAMP AT TIME ZONE $$UTC$$) - INTERVAL $$1 second$$ AND
                        (CURRENT_TIMESTAMP AT TIME ZONE $$UTC$$) + INTERVAL $$1 second$$ AS "webCreatedUtc",
                    inserted_web."available_at" BETWEEN
                        (CURRENT_TIMESTAMP AT TIME ZONE $$UTC$$) - INTERVAL $$1 second$$ AND
                        (CURRENT_TIMESTAMP AT TIME ZONE $$UTC$$) + INTERVAL $$1 second$$ AS "webAvailableUtc"
                FROM inserted_read CROSS JOIN inserted_web
            `);
            assertEqual(
                rollbackProbe.rows,
                [{ readCreatedUtc: true, readAvailableUtc: true, webCreatedUtc: true, webAvailableUtc: true }],
                "predecessor runtime DML compatibility"
            );
        } finally {
            await client.end();
        }
    '

if ! DATABASE_URL=$database_url PRISMA_SCHEMA="$prisma_dir/game.prisma" \
    pnpm exec prisma migrate deploy --schema "$prisma_dir/game.prisma" \
        >"$work_dir/noop-deploy.log" 2>&1; then
    echo "second outbox UTC-wall migration deploy failed" >&2
    exit 1
fi
grep -Fq 'No pending migrations to apply' "$work_dir/noop-deploy.log"

if ! DATABASE_URL=$database_url PRISMA_SCHEMA="$prisma_dir/game.prisma" \
    pnpm exec prisma migrate status --schema "$prisma_dir/game.prisma" \
        >"$work_dir/status.log" 2>&1; then
    echo "outbox UTC-wall migration status is not clean" >&2
    exit 1
fi
grep -Fq 'Database schema is up to date' "$work_dir/status.log"

SCHEMA_NAME=$schema_name \
    TARGET_MIGRATION=$target_migration \
    MIGRATION_FILE="$prisma_dir/migrations/$target_migration/migration.sql" \
    DATABASE_URL=$database_url \
    pnpm exec node --input-type=module -e '
        import { createHash } from "node:crypto";
        import { readFile } from "node:fs/promises";
        import pg from "pg";
        const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
        await client.connect();
        try {
            const expectedChecksum = createHash("sha256")
                .update(await readFile(process.env.MIGRATION_FILE))
                .digest("hex");
            const result = await client.query(`
                SELECT count(*)::int AS count,
                       bool_and(checksum = $2) AS "checksumMatches",
                       bool_and(finished_at IS NOT NULL) AS finished,
                       bool_and(rolled_back_at IS NULL) AS "notRolledBack",
                       sum(applied_steps_count)::int AS steps
                FROM ${`"${process.env.SCHEMA_NAME.replaceAll("\"", "\"\"")}"`}."_prisma_migrations"
                WHERE migration_name = $1
            `, [process.env.TARGET_MIGRATION, expectedChecksum]);
            const row = result.rows[0];
            if (
                row?.count !== 1 ||
                row.checksumMatches !== true ||
                row.finished !== true ||
                row.notRolledBack !== true ||
                row.steps !== 1
            ) {
                throw new Error(`unexpected target migration history after no-op deploy: ${JSON.stringify(row)}`);
            }
        } finally {
            await client.end();
        }
    '

echo "Game outbox UTC-wall populated upgrade, pending requeue, delivered preservation, checksum, no-op, and predecessor DML compatibility passed"
