#!/bin/sh
set -eu

: "${GATEWAY_MIGRATION_TEST_DATABASE_URL:?GATEWAY_MIGRATION_TEST_DATABASE_URL is required}"

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
package_dir=$(dirname "$script_dir")
prisma_dir="$package_dir/prisma"
target_migration=20260731001000_add_account_icon_revision
run_id=$(date -u +%m%d%H%M%S)_$$
predecessor_schema="gateway_icon_predecessor_$run_id"
fresh_schema="gateway_icon_fresh_$run_id"
ownership_token="sammo-gateway-icon-migration:$run_id"
work_dir=$(mktemp -d "$package_dir/.gateway-icon-migration.XXXXXX")

cleanup() {
    cleanup_status=0
    OWNERSHIP_TOKEN=$ownership_token \
        SCHEMA_NAMES="$predecessor_schema,$fresh_schema" \
        DATABASE_URL=$GATEWAY_MIGRATION_TEST_DATABASE_URL \
        pnpm --dir "$package_dir" exec node --input-type=module -e '
            import pg from "pg";
            const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
            const quoteIdentifier = (value) => `"${value.replaceAll("\"", "\"\"")}"`;
            await client.connect();
            try {
                for (const schema of process.env.SCHEMA_NAMES.split(",")) {
                    const ownership = await client.query(
                        "SELECT obj_description(oid, $$pg_namespace$$) AS owner FROM pg_namespace WHERE nspname = $1",
                        [schema]
                    );
                    if (ownership.rowCount === 0) continue;
                    if (ownership.rows[0]?.owner !== process.env.OWNERSHIP_TOKEN) {
                        throw new Error(`refusing to drop unowned schema: ${schema}`);
                    }
                    await client.query(`DROP SCHEMA ${quoteIdentifier(schema)} CASCADE`);
                }
            } finally {
                await client.end();
            }
        ' >/dev/null 2>&1 || cleanup_status=1
    case "$work_dir" in
        "$package_dir"/.gateway-icon-migration.*)
            rm -r -- "$work_dir" || cleanup_status=1
            ;;
        *)
            echo "refusing to remove unsafe migration work directory: $work_dir" >&2
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

[ -d "$prisma_dir/gateway-migrations/$target_migration" ] || {
    echo "target migration is missing: $target_migration" >&2
    exit 66
}

build_database_url() {
    SCHEMA_NAME=$1 DATABASE_URL=$GATEWAY_MIGRATION_TEST_DATABASE_URL \
        pnpm --dir "$package_dir" exec node --input-type=module -e '
            const url = new URL(process.env.DATABASE_URL);
            url.searchParams.set("schema", process.env.SCHEMA_NAME);
            process.stdout.write(url.href);
        '
}

predecessor_url=$(build_database_url "$predecessor_schema")
fresh_url=$(build_database_url "$fresh_schema")

OWNERSHIP_TOKEN=$ownership_token \
    SCHEMA_NAMES="$predecessor_schema,$fresh_schema" \
    DATABASE_URL=$GATEWAY_MIGRATION_TEST_DATABASE_URL \
    pnpm --dir "$package_dir" exec node --input-type=module -e '
        import pg from "pg";
        const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
        const quoteIdentifier = (value) => `"${value.replaceAll("\"", "\"\"")}"`;
        const apostrophe = String.fromCharCode(39);
        const quoteLiteral = (value) =>
            `${apostrophe}${value.replaceAll(apostrophe, apostrophe.repeat(2))}${apostrophe}`;
        await client.connect();
        try {
            for (const schema of process.env.SCHEMA_NAMES.split(",")) {
                await client.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
                await client.query(
                    `COMMENT ON SCHEMA ${quoteIdentifier(schema)} IS ${quoteLiteral(process.env.OWNERSHIP_TOKEN)}`
                );
            }
        } finally {
            await client.end();
        }
    '

stage_dir="$work_dir/stage"
mkdir -p "$stage_dir/gateway-migrations"
cp "$prisma_dir/gateway.prisma" "$stage_dir/gateway.prisma"
cat >"$stage_dir/prisma.config.ts" <<'EOF'
import { defineConfig } from 'prisma/config';

export default defineConfig({
    schema: './gateway.prisma',
    migrations: { path: './gateway-migrations' },
    datasource: { url: process.env.GATEWAY_DATABASE_URL! },
});
EOF

found_target=0
for migration_dir in "$prisma_dir"/gateway-migrations/[0-9]*; do
    migration_name=$(basename "$migration_dir")
    if [ "$migration_name" = "$target_migration" ]; then
        found_target=1
        break
    fi
    cp -R "$migration_dir" "$stage_dir/gateway-migrations/$migration_name"
done
[ "$found_target" -eq 1 ] || {
    echo "target migration was not found in migration order" >&2
    exit 1
}

cd "$package_dir"
GATEWAY_DATABASE_URL=$predecessor_url \
    pnpm exec prisma migrate deploy --schema "$stage_dir/gateway.prisma" --config "$stage_dir/prisma.config.ts" \
    >"$work_dir/predecessor-deploy.log"

SCHEMA_NAME=$predecessor_schema DATABASE_URL=$GATEWAY_MIGRATION_TEST_DATABASE_URL \
    pnpm exec node --input-type=module -e '
    import pg from "pg";
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    const quoteIdentifier = (value) => `"${value.replaceAll("\"", "\"\"")}"`;
    await client.connect();
    try {
        await client.query(`SET search_path TO ${quoteIdentifier(process.env.SCHEMA_NAME)}`);
        await client.query(`
            INSERT INTO app_user (
                id, login_id, display_name, password_hash, password_salt,
                sanctions, icon_updated_at, created_at, updated_at
            ) VALUES
                ($1, $1, $1, $1, $1, $2::jsonb, $3, $4, $4),
                ($5, $5, $5, $5, $5, $6::jsonb, $7, $4, $4),
                ($8, $8, $8, $8, $8, $9::jsonb, NULL, $4, $4)
        `, [
            "legacy-reset",
            JSON.stringify({ profileIconResetAt: "2026-07-25T09:00:00.123Z", notes: "preserve" }),
            "2026-07-20T00:00:00.000Z",
            "2026-07-01T00:00:00.000Z",
            "ordinary-icon",
            JSON.stringify({ notes: "preserve" }),
            "2026-07-20T00:00:00.000Z",
            "malformed-reset",
            JSON.stringify({ profileIconResetAt: 1234, notes: "preserve" }),
        ]);
    } finally {
        await client.end();
    }
'

failure_log="$work_dir/malformed-deploy.log"
if GATEWAY_DATABASE_URL=$predecessor_url \
    pnpm exec prisma migrate deploy --schema "$prisma_dir/gateway.prisma" --config "$package_dir/prisma.gateway.config.ts" \
    >"$failure_log" 2>&1; then
    echo "account icon migration unexpectedly accepted a malformed reset marker" >&2
    exit 1
fi

SCHEMA_NAME=$predecessor_schema TARGET_MIGRATION=$target_migration DATABASE_URL=$GATEWAY_MIGRATION_TEST_DATABASE_URL \
    pnpm exec node --input-type=module -e '
        import pg from "pg";
        const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
        const quoteIdentifier = (value) => `"${value.replaceAll("\"", "\"\"")}"`;
        await client.connect();
        try {
            await client.query(`SET search_path TO ${quoteIdentifier(process.env.SCHEMA_NAME)}`);
            const columns = await client.query(`
                SELECT count(*)::int AS count
                FROM information_schema.columns
                WHERE table_schema = $1
                  AND table_name = $$app_user$$
                  AND column_name IN ($$icon_revision$$, $$profile_icon_reset_at$$)
            `, [process.env.SCHEMA_NAME]);
            if (columns.rows[0].count !== 0) throw new Error("transactional DDL survived failed migration");
            const history = await client.query(`
                SELECT count(*)::int AS count,
                       bool_and(finished_at IS NULL) AS unfinished,
                       sum(applied_steps_count)::int AS steps
                FROM _prisma_migrations
                WHERE migration_name = $1
            `, [process.env.TARGET_MIGRATION]);
            const row = history.rows[0];
            if (row.count !== 1 || row.unfinished !== true || row.steps !== 0) {
                throw new Error(`unexpected failed migration history: ${JSON.stringify(row)}`);
            }
        } finally {
            await client.end();
        }
    '

GATEWAY_DATABASE_URL=$predecessor_url \
    pnpm exec prisma migrate resolve --rolled-back "$target_migration" \
    --schema "$prisma_dir/gateway.prisma" --config "$package_dir/prisma.gateway.config.ts" \
    >"$work_dir/resolve.log"

SCHEMA_NAME=$predecessor_schema DATABASE_URL=$GATEWAY_MIGRATION_TEST_DATABASE_URL \
    pnpm exec node --input-type=module -e '
    import pg from "pg";
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    const quoteIdentifier = (value) => `"${value.replaceAll("\"", "\"\"")}"`;
    await client.connect();
    try {
        await client.query(`SET search_path TO ${quoteIdentifier(process.env.SCHEMA_NAME)}`);
        await client.query(`
            UPDATE app_user
            SET sanctions = jsonb_set(sanctions, ARRAY[$$profileIconResetAt$$], to_jsonb($1::text))
            WHERE id = $$malformed-reset$$
        `, ["2026-07-26T10:00:00.456Z"]);
    } finally {
        await client.end();
    }
'

GATEWAY_DATABASE_URL=$predecessor_url \
    pnpm exec prisma migrate deploy --schema "$prisma_dir/gateway.prisma" --config "$package_dir/prisma.gateway.config.ts" \
    >"$work_dir/recovered-deploy.log"
GATEWAY_DATABASE_URL=$predecessor_url \
    pnpm exec prisma migrate deploy --schema "$prisma_dir/gateway.prisma" --config "$package_dir/prisma.gateway.config.ts" \
    >"$work_dir/noop-deploy.log"
grep -Fq 'No pending migrations to apply' "$work_dir/noop-deploy.log"

SCHEMA_NAME=$predecessor_schema DATABASE_URL=$GATEWAY_MIGRATION_TEST_DATABASE_URL \
    pnpm exec node --input-type=module -e '
    import pg from "pg";
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    const quoteIdentifier = (value) => `"${value.replaceAll("\"", "\"\"")}"`;
    await client.connect();
    try {
        await client.query(`SET search_path TO ${quoteIdentifier(process.env.SCHEMA_NAME)}`);
        const result = await client.query(`
            SELECT id,
                   to_char(icon_revision, $$YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"$$) AS revision,
                   CASE WHEN profile_icon_reset_at IS NULL THEN NULL
                        ELSE to_char(profile_icon_reset_at, $$YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"$$)
                   END AS reset,
                   sanctions
            FROM app_user
            ORDER BY id
        `);
        const expected = [
            { id: "legacy-reset", revision: "2026-07-25T09:00:00.123Z", reset: "2026-07-25T09:00:00.123Z", sanctions: { notes: "preserve" } },
            { id: "malformed-reset", revision: "2026-07-26T10:00:00.456Z", reset: "2026-07-26T10:00:00.456Z", sanctions: { notes: "preserve" } },
            { id: "ordinary-icon", revision: "2026-07-20T00:00:00.000Z", reset: null, sanctions: { notes: "preserve" } },
        ];
        if (JSON.stringify(result.rows) !== JSON.stringify(expected)) {
            throw new Error(`unexpected account icon backfill: ${JSON.stringify(result.rows)}`);
        }
    } finally {
        await client.end();
    }
'

GATEWAY_DATABASE_URL=$fresh_url \
    pnpm exec prisma migrate deploy --schema "$prisma_dir/gateway.prisma" --config "$package_dir/prisma.gateway.config.ts" \
    >"$work_dir/fresh-deploy.log"
GATEWAY_DATABASE_URL=$fresh_url \
    pnpm exec prisma migrate deploy --schema "$prisma_dir/gateway.prisma" --config "$package_dir/prisma.gateway.config.ts" \
    >"$work_dir/fresh-noop-deploy.log"
grep -Fq 'No pending migrations to apply' "$work_dir/fresh-noop-deploy.log"

echo "Gateway account icon migration backfill, rollback, recovery, and fresh deploy passed"
