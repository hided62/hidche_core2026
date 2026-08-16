#!/bin/sh
set -eu

workspace_root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
secret_env="$workspace_root/tools/load-tests/secrets/capacity.env"

if [ ! -f "$secret_env" ]; then
    echo "capacity.env is missing; run the load-test prepare command first" >&2
    exit 1
fi

secret_mode=$(stat -c '%a' "$secret_env")
if [ "$secret_mode" != "600" ]; then
    echo "capacity.env must have mode 0600" >&2
    exit 1
fi

set -a
# shellcheck disable=SC1090
. "$secret_env"
set +a

export GAME_API_ROLE=server
cd "$workspace_root"
exec taskset -c "${CAPACITY_CPUSET:-0-3}" "${CAPACITY_NODE_BINARY:-node}" app/game-api/dist/index.js
