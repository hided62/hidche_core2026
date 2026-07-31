#!/bin/sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
package_dir="$(dirname "$script_dir")"
prisma_dir="$package_dir/prisma"
target_migration=20260731000000_add_npc_selection_token
task_label=devsam.core2026.npc-selection-migration-preflight
container_name="sammo-npc-migration-preflight-$(date +%s)-$$"
schema_name="npc_selection_migration_preflight_$(date +%s)_$$"
work_dir="$(mktemp -d /tmp/sammo-npc-migration-preflight.XXXXXX)"
container_created=0

case "$container_name" in
    sammo-npc-migration-preflight-[0-9]*-[0-9]*) ;;
    *) echo "unsafe migration preflight container name" >&2; exit 64 ;;
esac
case "$schema_name" in
    npc_selection_migration_preflight_[0-9]*_[0-9]*) ;;
    *) echo "unsafe migration preflight schema name" >&2; exit 64 ;;
esac

cleanup() {
    cleanup_failed=0
    if [ "$container_created" -eq 1 ] && docker inspect "$container_name" >/dev/null 2>&1; then
        actual_label="$(docker inspect --format '{{ index .Config.Labels "devsam.core2026.task" }}' "$container_name")"
        if [ "$actual_label" != "$task_label" ]; then
            echo "refusing to remove container with unexpected ownership label: $container_name" >&2
            cleanup_failed=1
        elif ! docker rm -f "$container_name" >/dev/null; then
            cleanup_failed=1
        fi
    fi
    case "$work_dir" in
        /tmp/sammo-npc-migration-preflight.*)
            if [ -d "$work_dir" ] && ! rm -r -- "$work_dir"; then
                cleanup_failed=1
            fi
            ;;
        *)
            echo "refusing to remove unsafe migration preflight work directory: $work_dir" >&2
            cleanup_failed=1
            ;;
    esac
    if docker inspect "$container_name" >/dev/null 2>&1; then
        echo "migration preflight container remains after cleanup: $container_name" >&2
        cleanup_failed=1
    fi
    return "$cleanup_failed"
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

command -v docker >/dev/null 2>&1 || {
    echo "docker is required" >&2
    exit 69
}
command -v pnpm >/dev/null 2>&1 || {
    echo "pnpm is required" >&2
    exit 69
}
[ -d "$prisma_dir/migrations/$target_migration" ] || {
    echo "target migration is missing: $target_migration" >&2
    exit 66
}

umask 077
password="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
password_file="$work_dir/postgres_password"
printf '%s\n' "$password" >"$password_file"
chmod 0600 "$password_file"

docker run -d \
    --name "$container_name" \
    --label "devsam.core2026.task=$task_label" \
    --tmpfs /var/lib/postgresql:rw,nodev,nosuid,size=1g \
    --mount "type=bind,source=$password_file,target=/run/secrets/postgres_password,readonly" \
    -e POSTGRES_DB=sammo \
    -e POSTGRES_USER=sammo \
    -e POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password \
    -p 127.0.0.1::5432 \
    postgres:18.4-bookworm >/dev/null
container_created=1

if [ -n "$(docker inspect --format '{{ range .Mounts }}{{ if eq .Type "volume" }}volume{{ end }}{{ end }}' "$container_name")" ]; then
    echo "migration preflight container unexpectedly owns a Docker volume" >&2
    exit 1
fi

attempt=0
until docker exec "$container_name" pg_isready -U sammo -d sammo >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 60 ]; then
        docker logs --tail 100 "$container_name" >&2
        exit 1
    fi
    sleep 1
done

published_port="$(docker port "$container_name" 5432/tcp)"
published_port="${published_port##*:}"
case "$published_port" in
    ''|*[!0-9]*) echo "could not resolve PostgreSQL host port" >&2; exit 1 ;;
esac

export POSTGRES_HOST=127.0.0.1
export POSTGRES_PORT="$published_port"
export POSTGRES_DB=sammo
export POSTGRES_USER=sammo
export POSTGRES_PASSWORD="$password"
export POSTGRES_SCHEMA="$schema_name"
unset DATABASE_URL DATABASE_SCHEMA

stage_prisma="$work_dir/prisma"
mkdir -p "$stage_prisma/migrations"
cp "$prisma_dir/game.prisma" "$stage_prisma/game.prisma"
found_target=0
for migration_dir in "$prisma_dir"/migrations/[0-9]*; do
    migration_name="$(basename "$migration_dir")"
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
if ! PRISMA_SCHEMA="$stage_prisma/game.prisma" \
    pnpm exec prisma migrate deploy --schema "$stage_prisma/game.prisma" \
        >"$work_dir/predecessor-deploy.log" 2>&1; then
    sed -n '1,160p' "$work_dir/predecessor-deploy.log" >&2
    exit 1
fi

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U sammo -d sammo >/dev/null <<SQL
SET search_path TO "$schema_name";
INSERT INTO "general" ("id", "user_id", "name", "turn_time") VALUES
    (900001, 'npc-migration-duplicate-owner', '중복장수1', CURRENT_TIMESTAMP),
    (900002, 'npc-migration-duplicate-owner', '중복장수2', CURRENT_TIMESTAMP);
SQL

failure_log="$work_dir/duplicate-deploy.log"
if PRISMA_SCHEMA="$prisma_dir/game.prisma" \
    pnpm exec prisma migrate deploy --schema "$prisma_dir/game.prisma" >"$failure_log" 2>&1; then
    echo "migration unexpectedly accepted duplicate general owners" >&2
    exit 1
fi
grep -Fq 'current transaction is aborted' "$failure_log"

objects_after_failure="$(
    docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U sammo -d sammo -tAc "
        SELECT
            to_regclass('\"$schema_name\".\"select_npc_token\"') IS NULL
            AND to_regclass('\"$schema_name\".\"select_npc_token_valid_until_idx\"') IS NULL
            AND to_regclass('\"$schema_name\".\"general_user_id_key\"') IS NULL;
    "
)"
[ "$objects_after_failure" = "t" ] || {
    echo "NPC selection DDL survived the failed transactional migration" >&2
    exit 1
}

failed_metadata="$(
    docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U sammo -d sammo -tAc "
        SELECT
            count(*),
            bool_and(finished_at IS NULL),
            bool_and(rolled_back_at IS NULL),
            bool_and(logs IS NULL),
            sum(applied_steps_count)
        FROM \"$schema_name\".\"_prisma_migrations\"
        WHERE migration_name = '$target_migration';
    "
)"
[ "$failed_metadata" = "1|t|t|t|0" ] || {
    echo "unexpected target migration metadata after transactional failure: $failed_metadata" >&2
    exit 1
}

retry_log="$work_dir/retry-without-resolve.log"
if PRISMA_SCHEMA="$prisma_dir/game.prisma" \
    pnpm exec prisma migrate deploy --schema "$prisma_dir/game.prisma" >"$retry_log" 2>&1; then
    echo "Prisma unexpectedly retried a failed migration without resolve" >&2
    exit 1
fi
if ! grep -Fq 'Error: P3009' "$retry_log"; then
    echo "migration retry was not blocked by the unfinished Prisma history row" >&2
    sed -n '1,200p' "$retry_log" >&2
    exit 1
fi

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U sammo -d sammo >/dev/null <<SQL
SET search_path TO "$schema_name";
DELETE FROM "general" WHERE "id" = 900002;
SQL

if ! PRISMA_SCHEMA="$prisma_dir/game.prisma" \
    pnpm exec prisma migrate resolve --rolled-back "$target_migration" \
        --schema "$prisma_dir/game.prisma" >"$work_dir/resolve.log" 2>&1; then
    sed -n '1,200p' "$work_dir/resolve.log" >&2
    exit 1
fi

PRISMA_SCHEMA="$prisma_dir/game.prisma" \
    pnpm exec prisma migrate deploy --schema "$prisma_dir/game.prisma" >"$work_dir/recovered-deploy.log"
PRISMA_SCHEMA="$prisma_dir/game.prisma" \
    pnpm exec prisma migrate deploy --schema "$prisma_dir/game.prisma" >"$work_dir/noop-deploy.log"
grep -Fq 'No pending migrations to apply' "$work_dir/noop-deploy.log"
PRISMA_SCHEMA="$prisma_dir/game.prisma" \
    pnpm exec prisma migrate status --schema "$prisma_dir/game.prisma" >"$work_dir/status.log"
grep -Fq 'Database schema is up to date' "$work_dir/status.log"

objects_after_recovery="$(
    docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U sammo -d sammo -tAc "
        SELECT
            to_regclass('\"$schema_name\".\"select_npc_token\"') IS NOT NULL
            AND to_regclass('\"$schema_name\".\"select_npc_token_valid_until_idx\"') IS NOT NULL
            AND to_regclass('\"$schema_name\".\"general_user_id_key\"') IS NOT NULL;
    "
)"
[ "$objects_after_recovery" = "t" ] || {
    echo "NPC selection table or indexes are missing after recovery" >&2
    exit 1
}

migration_rows_after_recovery="$(
    docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U sammo -d sammo -tAc "
        SELECT
            count(*) FILTER (WHERE rolled_back_at IS NOT NULL),
            count(*) FILTER (WHERE finished_at IS NOT NULL)
        FROM \"$schema_name\".\"_prisma_migrations\"
        WHERE migration_name = '$target_migration';
    "
)"
[ "$migration_rows_after_recovery" = "1|1" ] || {
    echo "unexpected Prisma migration history after recovery: $migration_rows_after_recovery" >&2
    exit 1
}

echo "NPC selection migration duplicate preflight and recovery passed"
