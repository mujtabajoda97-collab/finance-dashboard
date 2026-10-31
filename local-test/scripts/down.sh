#!/usr/bin/env bash
# Stops the local stack and DELETES its volumes, then proves nothing is left.
source "$(dirname "$0")/_common.sh"
[ -d "$WORK" ] && (cd "$WORK" && sb stop --no-backup --project-id "$PROJECT_ID" || true)
left=$(docker ps -a --format '{{.Names}}' | grep -c "$PROJECT_ID" || true)
vols=$(docker volume ls --format '{{.Name}}' | grep -c "$PROJECT_ID" || true)
rm -rf "$WORK" "$HARNESS/.env.local-test"
echo "containers left: $left, volumes left: $vols"
[ "$left" = 0 ] && [ "$vols" = 0 ] && echo "✔ clean" || { echo "✘ remove manually: docker rm -f \$(docker ps -aq -f name=$PROJECT_ID); docker volume rm \$(docker volume ls -q -f name=$PROJECT_ID)"; exit 1; }
