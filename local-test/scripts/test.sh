#!/usr/bin/env bash
# HTTP tests (anon key only) + best-effort SQL suites inside the local container.
source "$(dirname "$0")/_common.sh"
set -a; source "$HARNESS/.env.local-test"; set +a
export BASE_URL="$API_URL"
cd "$HARNESS" && node tests/run.mjs
