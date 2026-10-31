#!/usr/bin/env bash
# Starts an isolated local stack (project_id supabase-test-0003, PostgreSQL 17) and applies 0001 only.
source "$(dirname "$0")/_common.sh"
bash "$(dirname "$0")/preflight.sh"
rm -rf "$WORK"; mkdir -p "$WORK"; cd "$WORK"
sb init --force >/dev/null
CFG=supabase/config.toml
sed -i -E "s/^project_id *=.*/project_id = \"$PROJECT_ID\"/" $CFG
sed -i -E "s/^major_version *=.*/major_version = 17/" $CFG
for sec in studio realtime storage edge_runtime analytics inbucket; do
  # disable optional services to save RAM (the section header may or may not exist in this CLI version)
  awk -v s="[$sec]" 'BEGIN{x=0} $0==s{x=1} x&&/^enabled *=/{sub(/true/,"false");x=0} {print}' $CFG > $CFG.tmp && mv $CFG.tmp $CFG
done
awk 'BEGIN{x=0} /^\[auth\.email\]/{x=1} x&&/^enable_confirmations *=/{sub(/true/,"false");x=0} {print}' $CFG > $CFG.tmp && mv $CFG.tmp $CFG
sed -i -E 's/^enable_signup *=.*/enable_signup = true/' $CFG
echo "starting local stack (first run downloads images; needs internet to the registries)…"
sb start -x studio,realtime,storage-api,imgproxy,edge-runtime,logflare,vector,mailpit,supavisor 2>&1 | sed -E 's/(service_role key|secret key|JWT secret|S3 [A-Za-z ]*key|Secret key)[^$]*$/\1: <hidden>/I'
# apply the original schema only (0002 needs pg_cron and is not part of this test)
psql_local < "$ROOT/supabase/migrations/"0001_*.sql >/dev/null
echo "✔ 0001 applied to the LOCAL database"
sb status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY)=' > "$HARNESS/.env.local-test"
chmod 600 "$HARNESS/.env.local-test"
echo "✔ stack is up (only API_URL and ANON_KEY saved to local-test/.env.local-test)"
