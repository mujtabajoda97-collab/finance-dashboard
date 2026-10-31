#!/usr/bin/env bash
# One command: up → apply 0003 ×2 → HTTP tests → rollback rehearsal → re-apply → tests again → down.
D="$(dirname "$0")"
trap 'bash "$D/down.sh" || true' EXIT
bash "$D/up.sh"
bash "$D/apply.sh"
bash "$D/test.sh"
bash "$D/rollback_rehearsal.sh"
bash "$D/sql_suites.sh" || true
echo "ALL STAGES DONE"
