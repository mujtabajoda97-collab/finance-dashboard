#!/usr/bin/env bash
# Refuses to run if anything could point at the real project, Vercel, or a secret key.
source "$(dirname "$0")/_common.sh"
fail=0
echo "== preflight =="
command -v docker >/dev/null || { echo "✘ docker not found"; exit 1; }
docker info >/dev/null 2>&1 || { echo "✘ docker daemon is not running"; exit 1; }
echo "✔ docker $(docker version --format '{{.Server.Version}}' 2>/dev/null)"
node -e 'process.exit(+process.versions.node.split(".")[0]>=20?0:1)' || { echo "✘ Node >= 20 required"; exit 1; }
echo "✔ node $(node -v)"
# forbidden strings in the harness itself (this file and guards list them on purpose, so they are excluded)
if grep -rnE 'rhsqratwipnyhldxdqyo|qdicurevkwntgqhmrzim|\.supabase\.co|sb_secret_|service_role[^_ ]*key|vercel' \
     --include='*.sh' --include='*.mjs' --include='*.json' --include='*.toml' "$HARNESS" 2>/dev/null \
     | grep -vE 'guards\.mjs|guards\.test\.mjs|preflight\.sh|README|\.stack/|_common\.sh'; then
  echo "✘ forbidden string found in harness files"; fail=1
fi
# environment: nothing that looks like a remote project / secret may be exported
if env | grep -E '^(SUPABASE_(ACCESS_TOKEN|DB_PASSWORD|SERVICE_ROLE_KEY|JWT_SECRET)|VERCEL_|NEXT_PUBLIC_SUPABASE_URL)=' | sed 's/=.*/=<hidden>/'; then
  echo "✘ the variables above are set in your shell; unset them and retry"; fail=1
fi
# migrations must exist and be unmodified-looking
for f in 0001_init.sql 0003_phase3_financial.sql; do
  ls "$ROOT/supabase/migrations/"${f%%_*}_*.sql >/dev/null 2>&1 || { echo "✘ missing migration ${f%%_*}"; fail=1; }
done
# ports must be free
for p in 54321 54322; do (echo >/dev/tcp/127.0.0.1/$p) 2>/dev/null && { echo "✘ port $p already in use (another local Supabase?)"; fail=1; }; done
[ $fail -eq 0 ] && echo "✔ preflight passed" || { echo "preflight FAILED"; exit 1; }
