#!/bin/sh
set -eu

: "${GATEWAY_MIGRATION_TEST_DATABASE_URL:?GATEWAY_MIGRATION_TEST_DATABASE_URL is required}"

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
package_dir=$(dirname "$script_dir")
prisma_dir="$package_dir/prisma"
target_migration=20260808000000_add_kakao_talk_verification
run_id=$(date -u +%m%d%H%M%S)_$$
predecessor_schema="gateway_kakao_predecessor_$run_id"
fresh_schema="gateway_kakao_fresh_$run_id"
ownership_token="sammo-gateway-kakao-migration:$run_id"
work_dir=$(mktemp -d "$package_dir/.gateway-kakao-migration.XXXXXX")

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
        "$package_dir"/.gateway-kakao-migration.*)
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
        const quoteLiteral = (value) => `$$${value}$$`;
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
cp "$script_dir/fixtures/gateway-migration.config.mjs" "$stage_dir/prisma.config.mjs"

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
    pnpm exec prisma migrate deploy --schema "$stage_dir/gateway.prisma" --config "$stage_dir/prisma.config.mjs" \
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
                    oauth_type, oauth_id, email, legacy_data, created_at, updated_at
                ) VALUES
                    ($1, $1, $1, $1, $1, $$KAKAO$$, $$kakao-valid$$, $$valid@example.com$$,
                     $2::jsonb, $3, $3),
                    ($4, $4, $4, $4, $4, $$KAKAO$$, $$kakao-malformed$$, $$malformed@example.com$$,
                     $5::jsonb, $3, $3),
                    ($6, $6, $6, $6, $6, $$NONE$$, NULL, NULL,
                     $7::jsonb, $3, $3)
            `, [
                "valid-kakao-user",
                JSON.stringify({ tokenValidUntil: "2026-08-18 05:57:00" }),
                "2026-08-01T00:00:00.000Z",
                "malformed-kakao-user",
                JSON.stringify({ tokenValidUntil: "not-a-date" }),
                "ordinary-user",
                JSON.stringify({ tokenValidUntil: "2026-08-18 05:57:00" }),
            ]);
        } finally {
            await client.end();
        }
    '

GATEWAY_DATABASE_URL=$predecessor_url \
    pnpm exec prisma migrate deploy --schema "$prisma_dir/gateway.prisma" --config "$package_dir/prisma.gateway.config.ts" \
    >"$work_dir/incremental-deploy.log"
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
            const rows = await client.query(`
                SELECT id, kakao_talk_verified_until AS "validUntil"
                FROM app_user
                ORDER BY id
            `);
            const values = Object.fromEntries(rows.rows.map((row) => [row.id, row.validUntil?.toISOString() ?? null]));
            if (values["valid-kakao-user"] !== "2026-08-18T05:57:00.000Z") {
                throw new Error(`legacy validity was not preserved: ${JSON.stringify(values)}`);
            }
            if (values["malformed-kakao-user"] !== null || values["ordinary-user"] !== null) {
                throw new Error(`unsafe legacy validity was imported: ${JSON.stringify(values)}`);
            }
        } finally {
            await client.end();
        }
    '

GATEWAY_DATABASE_URL=$fresh_url \
    pnpm exec prisma migrate deploy --schema "$prisma_dir/gateway.prisma" --config "$package_dir/prisma.gateway.config.ts" \
    >"$work_dir/fresh-deploy.log"

SCHEMA_NAME=$fresh_schema TARGET_MIGRATION=$target_migration DATABASE_URL=$GATEWAY_MIGRATION_TEST_DATABASE_URL \
    pnpm exec node --input-type=module -e '
        import pg from "pg";
        const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
        await client.connect();
        try {
            const result = await client.query(`
                SELECT count(*)::int AS count
                FROM information_schema.columns
                WHERE table_schema = $1
                  AND table_name = $$app_user$$
                  AND column_name = $$kakao_talk_verified_until$$
            `, [process.env.SCHEMA_NAME]);
            if (result.rows[0]?.count !== 1) throw new Error("fresh migration column is missing");
        } finally {
            await client.end();
        }
    '

echo "KakaoTalk verification migration checks passed."
