#!/bin/sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
package_dir="$(dirname "$script_dir")"
prisma_dir="$package_dir/prisma"
target_migration=20260903140000_split_message_wall_and_game_time
task_label=devsam.core2026.time-domain-migration-preflight
run_id="$(date -u +%m%d%H%M%S)_$$"
container_name="sammo-time-domain-preflight-$run_id"
schema_name="time_domain_preflight_$run_id"
work_dir="$(mktemp -d /tmp/sammo-time-domain-preflight.XXXXXX)"
container_created=0

case "$container_name" in sammo-time-domain-preflight-[0-9]*_[0-9]*) ;; *) exit 64 ;; esac
case "$schema_name" in time_domain_preflight_[0-9]*_[0-9]*) ;; *) exit 64 ;; esac

cleanup() {
    cleanup_failed=0
    if [ "$container_created" -eq 1 ] && docker inspect "$container_name" >/dev/null 2>&1; then
        actual_label="$(docker inspect --format '{{ index .Config.Labels "devsam.core2026.task" }}' "$container_name")"
        if [ "$actual_label" != "$task_label" ]; then
            echo "refusing to remove container with unexpected ownership label" >&2
            cleanup_failed=1
        elif ! docker rm -f "$container_name" >/dev/null; then
            cleanup_failed=1
        fi
    fi
    case "$work_dir" in
        /tmp/sammo-time-domain-preflight.*) rm -r -- "$work_dir" || cleanup_failed=1 ;;
        *) cleanup_failed=1 ;;
    esac
    return "$cleanup_failed"
}
handle_exit() {
    exit_status=$?
    trap - EXIT HUP INT TERM
    if ! cleanup && [ "$exit_status" -eq 0 ]; then exit_status=1; fi
    exit "$exit_status"
}
trap handle_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 69; }
[ -d "$prisma_dir/migrations/$target_migration" ] || { echo "target migration is missing" >&2; exit 66; }

umask 077
password="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
password_file="$work_dir/postgres_password"
printf '%s\n' "$password" >"$password_file"

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
    echo "preflight container unexpectedly owns a Docker volume" >&2
    exit 1
fi

attempt=0
until docker exec "$container_name" pg_isready -U sammo -d sammo >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 60 ]; then docker logs --tail 100 "$container_name" >&2; exit 1; fi
    sleep 1
done

published_port="$(docker port "$container_name" 5432/tcp)"
published_port="${published_port##*:}"
case "$published_port" in ''|*[!0-9]*) exit 1 ;; esac

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
    if [ "$migration_name" = "$target_migration" ]; then found_target=1; break; fi
    cp -R "$migration_dir" "$stage_prisma/migrations/$migration_name"
done
[ "$found_target" -eq 1 ] || exit 1

cd "$package_dir"
PRISMA_SCHEMA="$stage_prisma/game.prisma" \
    pnpm exec prisma migrate deploy --schema "$stage_prisma/game.prisma" >"$work_dir/predecessor.log"

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U sammo -d sammo >/dev/null <<SQL
SET search_path TO "$schema_name";
INSERT INTO world_state (
    scenario_code, current_year, current_month, tick_seconds,
    clock_base_time, clock_tick, clock_wall_anchor, last_turn_tick, updated_at
) VALUES (
    'time-domain-fixture', 200, 1, 600,
    TIMESTAMP '0200-01-01 00:00:00', 36000000, TIMESTAMP '2026-09-03 00:00:00', 36000000,
    TIMESTAMP '2026-09-03 00:00:00'
);
INSERT INTO general (id, name, turn_time, meta)
VALUES (
    910001,
    '시간장수',
    TIMESTAMP '0200-01-01 00:10:00',
    jsonb_build_object(
        'next_change', '0200-01-01T00:30:00.000Z',
        'nextChangeAt', '0200-01-01T00:30:00.000Z'
    )
);
INSERT INTO message (id, mailbox, type, src, dest, time, time_tick, valid_until, valid_until_tick, message)
VALUES
    (920001, 0, 'global', 1, 0, TIMESTAMP '0200-01-01 00:00:00', 36000000,
        TIMESTAMP '9999-12-31 00:00:00', 9007199254740991,
        jsonb_build_object('text', 'normal')),
    (920002, 1, 'private', 1, 2, TIMESTAMP '0200-01-01 00:05:00', 54000000,
        TIMESTAMP '0200-01-01 01:00:00', 252000000,
        jsonb_build_object('option', jsonb_build_object('action', 'raiseInvader', 'used', false))),
    (920003, 2, 'private', 1, 2, TIMESTAMP '0200-01-01 00:06:00', NULL,
        TIMESTAMP '0200-01-01 01:00:00', NULL,
        jsonb_build_object('option', jsonb_build_object('action', 'scout', 'used', false)));
INSERT INTO auction (id, type, host_general_id, status, close_at, open_tick, close_tick)
VALUES (930001, 'UNIQUE_ITEM', 910001, 'OPEN', TIMESTAMP '0200-01-01 01:00:00', 36000000, 252000000);
INSERT INTO auction_bid (id, auction_id, general_id, amount, event_id, event_at, created_at)
VALUES (930002, 930001, 910001, 100, 'time-domain-bid', TIMESTAMP '0200-01-01 00:10:00',
    TIMESTAMP '2026-09-03 01:02:03.456');
SQL

PRISMA_SCHEMA="$prisma_dir/game.prisma" \
    pnpm exec prisma migrate deploy --schema "$prisma_dir/game.prisma" >"$work_dir/target.log"
PRISMA_SCHEMA="$prisma_dir/game.prisma" \
    pnpm exec prisma migrate deploy --schema "$prisma_dir/game.prisma" >"$work_dir/noop.log"
grep -Fq 'No pending migrations to apply' "$work_dir/noop.log"

result="$(docker exec "$container_name" psql -v ON_ERROR_STOP=1 -U sammo -d sammo -tAc "
SET search_path TO \"$schema_name\";
SELECT
    (SELECT count(*) FROM message_action) = 2
    AND (SELECT action_type = 'raiseInvader' AND status = 'PENDING' AND expires_game_tick = 252000000
         FROM message_action WHERE message_id = 920002)
    AND (SELECT status = 'RESOLVED' AND resolved_game_tick = 0
         FROM message_action WHERE message_id = 920003)
    AND (SELECT requested_at_wall = TIMESTAMP '2026-09-03 01:02:03.456'
                AND occurred_game_tick = 36000000
         FROM auction_bid WHERE id = 930002)
    AND (SELECT (meta->>'next_change_tick')::bigint = 108000000 FROM general WHERE id = 910001)
    AND (SELECT delete_until_wall <= CURRENT_TIMESTAMP AT TIME ZONE 'UTC' FROM message WHERE id = 920001)
    AND to_regclass('\"$schema_name\".inheritance_ledger') IS NOT NULL;
" | tail -n 1)"
[ "$result" = "t" ] || { echo "time-domain migration assertions failed: $result" >&2; exit 1; }

echo "time-domain populated migration and no-op redeploy passed"
