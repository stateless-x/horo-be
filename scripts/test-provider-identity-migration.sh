#!/bin/sh
set -eu

repo=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
migration="$repo/drizzle/0013_provider_identity.sql"

run_fixture() {
  fixture=$1
  docker run --rm \
    -e POSTGRES_HOST_AUTH_METHOD=trust \
    -v "$repo/$fixture:/test.sql:ro" \
    -v "$migration:/migration.sql:ro" \
    postgres:16-alpine sh -c '
      docker-entrypoint.sh postgres >/tmp/postgres.log 2>&1 &
      server_pid=$!
      until pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
      set +e
      psql -v ON_ERROR_STOP=1 -U postgres -f /test.sql
      result=$?
      set -e
      kill "$server_pid"
      wait "$server_pid"
      exit "$result"
    '
}

run_fixture tests/sql/provider-identity-main.sql

set +e
tie_output=$(run_fixture tests/sql/provider-identity-tie.sql 2>&1)
tie_status=$?
set -e
printf '%s\n' "$tie_output"

if [ "$tie_status" -eq 0 ]; then
  echo 'Expected tied provider timestamps to stop the migration' >&2
  exit 1
fi

printf '%s\n' "$tie_output" | grep -q 'multiple providers share the earliest account creation time'
echo 'provider identity migration: main, reverse, unaffected, and tie guard passed'
