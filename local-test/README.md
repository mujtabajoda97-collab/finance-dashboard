# local-test — isolated test of migration 0003 (Supabase CLI + Docker)

Everything runs on YOUR machine, in containers named `supabase_*_supabase-test-0003`, on ports 54321/54322.
It never reads or writes the real project, Vercel or any secret key: only the local API URL and the local ANON key are used.

Requirements: Docker running (≈7 GB RAM free), Node ≥ 20, Supabase CLI (stable) or `SUPABASE_CLI_VERSION=<exact stable>` for npx.

    cd local-test
    bash scripts/run-all.sh        # up → 0003 ×2 → HTTP tests → rollback rehearsal → re-apply → SQL suites → down

Individual steps: preflight.sh, up.sh, apply.sh, test.sh, rollback_rehearsal.sh, sql_suites.sh, down.sh.
`down.sh` runs `supabase stop --no-backup` and proves no container/volume remains.
Guards: `node --test tests/guards.test.mjs` (env/URL/key/test-name checks). Test users are `test_*@example.test`, names `TEST_*`.
