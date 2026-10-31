#!/usr/bin/env bash
# Full lifecycle on a THROWAWAY sim DB (Supabase-like roles/ACLs, local PostgreSQL):
#   0001 + legacy data -> 0003 -> 0003 again -> suites -> 0004 -> suites -> rollback A (guarded) -> invariants
#   -> 0003 again -> suites.   Legacy balances/debts must be byte-identical at every checkpoint.
set -uo pipefail
P="-h /var/lib/postgresql/p3test -p 54329"; D=$(cd "$(dirname "$0")/.." && pwd); DB=${1:-cycle}
H="psql $P -q -U pgsim -d $DB"; FAIL=0
ensure_pg(){ psql $P -q -U pgsim -d postgres -c 'select 1' >/dev/null 2>&1 || { rm -f /var/lib/postgresql/p3test/data/postmaster.pid
  su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/p3test/data -o '-p 54329 -k /var/lib/postgresql/p3test -c listen_addresses=' -l /var/lib/postgresql/p3test/log start" >/dev/null 2>&1; }; }
ensure_pg
ok(){ echo "  ✔ $1"; }; bad(){ echo "  ✘ $1"; FAIL=$((FAIL+1)); }
chk(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (got: $2 | expected: $3)"; fi; }
fresh(){ psql $P -q -U postgres -d postgres -c "drop database if exists $DB" -c "create database $DB owner pgsim" 2>&1 | grep -v NOTICE
         psql $P -q -U postgres -d $DB -f "$D/tests/supabase_sim_setup.sql" 2>&1 | grep -v NOTICE; }
applyf(){ # label file [sed-expr]  -> exit status based, never text based
  if [ -n "${3:-}" ]; then sed "$3" "$2" | $H -v ON_ERROR_STOP=1 >/tmp/ap.out 2>&1; rc=${PIPESTATUS[1]}; else $H -v ON_ERROR_STOP=1 -f "$2" >/tmp/ap.out 2>&1; rc=$?; fi
  if [ $rc -eq 0 ]; then ok "$1"; else bad "$1: $(grep -m1 -i 'error' /tmp/ap.out)"; fi; }
suite(){ ensure_pg; # name file
  $H -f "$D/tests/$2" > /tmp/cyc_$1.txt 2>&1; local rc=$?; local p f; p=$(grep -c PASS /tmp/cyc_$1.txt); f=$(grep -c 'FAIL' /tmp/cyc_$1.txt)
  if [ $rc -eq 0 ] && [ "$f" = 0 ]; then ok "$1: $p assertions passed"; else bad "$1: rc=$rc fail=$f ($(grep -m1 FAIL /tmp/cyc_$1.txt))"; fi; }
snap(){ $H -At -c "reset role; select md5(coalesce((select string_agg(id::text||balance::text,',' order by id) from wallets where user_id='99999999-0000-0000-0000-000000000009'),'')||'|'||coalesce((select string_agg(id::text||paid_amount::text||status::text,',' order by id) from debts where user_id='99999999-0000-0000-0000-000000000009'),'')||'|'||(select count(*) from transactions where user_id='99999999-0000-0000-0000-000000000009')||'|'||(select count(*) from debt_payments where user_id='99999999-0000-0000-0000-000000000009'))"; }

echo "== 1. 0001 + legacy data (written by 0001 triggers only) =="
fresh; applyf "0001 applied" "$D/migrations/0001_init.sql"
$H -v ON_ERROR_STOP=1 <<'SQL' 2>&1 | grep -v NOTICE
insert into auth.users(id,email) values ('99999999-0000-0000-0000-000000000009','legacy@test');
set role authenticated; select set_config('request.jwt.claim.sub','99999999-0000-0000-0000-000000000009',false) \gset
insert into wallets(name,currency,opening_balance) values ('LA','AED',5000),('LB','AED',0),('LS','SDG',0);
insert into transactions(wallet_id,type,category,amount) select id,'INCOME','SALARY',1500 from wallets where name='LA';
insert into transactions(wallet_id,type,category,amount) select id,'EXPENSE','FOOD',230.50 from wallets where name='LA';
insert into transactions(wallet_id,to_wallet_id,type,category,amount) select a.id,b.id,'TRANSFER','INTERNAL_TRANSFER',700 from wallets a,wallets b where a.name='LA' and b.name='LB';
insert into transactions(wallet_id,to_wallet_id,type,category,amount,to_amount) select a.id,b.id,'TRANSFER','INTERNAL_TRANSFER',100,16000 from wallets a,wallets b where a.name='LA' and b.name='LS';
insert into transactions(wallet_id,type,category,amount) select id,'TRANSFER','SUDAN_TRANSFER',300 from wallets where name='LA';
insert into debts(person_name,type,total_amount) values ('LD1','PAYABLE',1000),('LD2','RECEIVABLE',400);
insert into debt_payments(debt_id,wallet_id,amount) select d.id,w.id,250 from debts d,wallets w where d.person_name='LD1' and w.name='LA';
insert into debt_payments(debt_id,wallet_id,amount) select d.id,w.id,400 from debts d,wallets w where d.person_name='LD2' and w.name='LB';
SQL
S0=$(snap); echo "  legacy snapshot: $S0"
chk "legacy balances (LA/LB/LS)" "$($H -At -c "reset role; select string_agg(name||'='||balance, ' ' order by name) from wallets where user_id='99999999-0000-0000-0000-000000000009'")" "LA=4919.50 LB=1100.00 LS=16000.00"

echo "== 2. apply 0003, then again =="
applyf "0003 first apply" "$D/migrations/0003_phase3_financial.sql"
chk "legacy snapshot unchanged after 0003" "$(snap)" "$S0"
applyf "0003 re-apply (idempotent)" "$D/migrations/0003_phase3_financial.sql"
chk "legacy snapshot unchanged after re-apply" "$(snap)" "$S0"
chk "legacy reconciliation drift" "$($H -At -c "reset role; select count(*) from wallet_reconciliation where user_id='99999999-0000-0000-0000-000000000009' and drift<>0")" "0"
$H -f "$D/tests/catalog_expect_0003.sql" > /tmp/cyc_cat.txt 2>&1 && ok "catalog expectations (8 functions + objects): $(grep -c PASS /tmp/cyc_cat.txt) checks" || bad "catalog: $(grep -m1 ERROR /tmp/cyc_cat.txt)"
echo "== 3. suites on 0003 =="
suite behavior 0003_behavior.sql; suite debts_multicurrency 0003_debt_multicurrency.sql; suite privileges 0003_privileges.sql; suite request_style 0003_request_style.sql
$H -f "$D/tests/0003_ui_integration_seed.sql" > /tmp/cyc_ui.json 2>/dev/null; chk "UI dataset buckets (month_summary) identical to committed fixture" \
  "$(python3 -c "import json;d=json.load(open('/tmp/cyc_ui.json'));[w.pop('id') for w in d['wallets']];print(json.dumps([d['buckets'],d['drift'],d['wallets']],sort_keys=True))")" \
  "$(python3 -c "import json;d=json.load(open('$D/../tests/fixtures/ui_month.json'));[w.pop('id') for w in d['wallets']];print(json.dumps([d['buckets'],d['drift'],d['wallets']],sort_keys=True))")"
chk "legacy snapshot unchanged after all suites" "$(snap)" "$S0"

echo "== 4. 0004 (proposal) on top =="
applyf "0004 apply" "$D/proposals/0004_revoke_anon_proposal.sql" 's/for role postgres/for role pgsim/' 
chk "anon table/sequence grants left" "$($H -At -c "select count(*) from information_schema.role_table_grants where grantee='anon' and table_schema='public'")" "0"
chk "authenticated keeps DML on wallets" "$($H -At -c "select has_table_privilege('authenticated','public.wallets','INSERT')")" "t"
chk "new function not executable by anon (PUBLIC default removed)" "$($H -At -c "create function public.probe_c() returns int language sql as 'select 1'; select has_function_privilege('anon','public.probe_c()','EXECUTE'); drop function public.probe_c()" | head -1)" "f"
chk "4 trigger fns closed to anon/authenticated" "$($H -At -c "select count(*) from pg_proc where proname in ('forbid_update','task_before_update','touch_updated_at','wallet_opening_balance') and (has_function_privilege('anon',oid,'EXECUTE') or has_function_privilege('authenticated',oid,'EXECUTE'))")" "0"
$H -c "delete from transactions where false" >/dev/null
# the app flows must still work with 0004 in place (fresh users: the suites seed their own)
$H -c "reset role; truncate wallets, debts, budgets cascade; delete from auth.users;" 2>&1 | grep -iv notice
suite behavior+0004 0003_behavior.sql; suite debts+0004 0003_debt_multicurrency.sql; suite privileges+0004 0003_privileges.sql

echo "== 5. rollback Level A (guarded) =="
$H -f "$D/rollback/0003_rollback.sql" > /tmp/rb_refuse.txt 2>&1; grep -q "ROLLBACK REFUSED" /tmp/rb_refuse.txt && ok "refused without CONFIRM" || bad "rollback not refused without CONFIRM"
chk "refusal changed nothing (0003 triggers still present)" "$($H -At -c "select count(*) from pg_trigger where tgname in ('trg_transaction_validate','trg_debt_payment_before_insert','trg_debt_before_update','trg_wallet_currency_lock')")" "4"
applyf "rollback A applied" "$D/rollback/0003_rollback.sql" "s/^-- set rollback.ui_disabled = 'yes';/set rollback.ui_disabled = 'yes';/"
chk "0003 triggers left" "$($H -At -c "select count(*) from pg_trigger where tgname in ('trg_transaction_validate','trg_debt_payment_before_insert','trg_debt_before_update','trg_wallet_currency_lock')")" "0"
chk "SECURITY DEFINER fns pinned" "$($H -At -c "select count(*) filter (where coalesce(proconfig,'{}') @> array['search_path=public, pg_temp'])||'/'||count(*) from pg_proc where pronamespace='public'::regnamespace and prosecdef")" "11/11"
chk "rollback level A kept the 4 new columns and budgets (no structure/data dropped)" "$($H -At -c "select (select count(*) from information_schema.columns where table_schema='public' and (table_name,column_name) in (('transactions','client_request_id'),('debt_payments','client_request_id'),('debt_payments','wallet_amount'),('debt_payments','exchange_rate_used')))||'/'||(select count(*) from information_schema.tables where table_schema='public' and table_name='budgets')")" "4/1"
$H -At <<'SQL' > /tmp/cyc_rb.txt 2>&1
insert into auth.users(id,email) values ('88888888-0000-0000-0000-000000000008','rb@test') on conflict do nothing;
set role authenticated; select set_config('request.jwt.claim.sub','88888888-0000-0000-0000-000000000008',false) \gset
insert into wallets(name,currency,opening_balance) values ('RA','AED',1000),('RS','SDG',0);
insert into debts(person_name,type,currency,total_amount) values ('RD','PAYABLE','SDG',1000),('RE','PAYABLE','AED',100);
\set ON_ERROR_STOP off
insert into debt_payments(debt_id,wallet_id,amount) select d.id,w.id,500 from debts d,wallets w where d.person_name='RD' and w.name='RA';
insert into debt_payments(debt_id,wallet_id,amount) select d.id,w.id,50 from debts d,wallets w where d.person_name='RE' and w.name='RS';
insert into debt_payments(debt_id,wallet_id,amount) select d.id,w.id,40 from debts d,wallets w where d.person_name='RE' and w.name='RA';
select 'RA='||balance from wallets where name='RA';
SQL
chk "cross-currency installments rejected after rollback; same-currency works (RA 1000-40)" "$(tail -1 /tmp/cyc_rb.txt)" "RA=960.00"
grep -c "Cross-currency debt payments are disabled" /tmp/cyc_rb.txt | xargs -I{} bash -c '[ {} = 2 ] && echo "  ✔ both cross-currency attempts rejected by the guard" || echo "  ✘ guard count {}"'
$H -f "$D/tests/catalog_expect_0003.sql" >/dev/null 2>&1 && bad "catalog expectations should FAIL after rollback" || ok "catalog expectations correctly fail after rollback (negative control)"

echo "== 6. re-apply 0003 after rollback =="
applyf "re-apply after rollback" "$D/migrations/0003_phase3_financial.sql"
$H -f "$D/tests/catalog_expect_0003.sql" > /tmp/cyc_cat2.txt 2>&1 && ok "catalog expectations pass again: $(grep -c PASS /tmp/cyc_cat2.txt) checks" || bad "catalog after re-apply: $(grep -m1 ERROR /tmp/cyc_cat2.txt)"
$H -c "reset role; truncate wallets, debts, budgets cascade; delete from auth.users;" 2>&1 | grep -iv notice
suite behavior+reapply 0003_behavior.sql; suite debts+reapply 0003_debt_multicurrency.sql

echo "== 7. rollback Level B =="
sed -n '/^-- begin;$/,$p' "$D/rollback/0003_rollback.sql" | sed 's/^-- \?//' > /tmp/levelB.sql
sed "s/^-- set rollback.ui_disabled = 'yes';/set rollback.ui_disabled = 'yes';/" "$D/rollback/0003_rollback.sql" | $H -v ON_ERROR_STOP=1 >/dev/null 2>&1   # A again (data present)
$H -v ON_ERROR_STOP=1 -f /tmp/levelB.sql > /tmp/lb.out 2>&1; rc=$?
if [ $rc -ne 0 ] && grep -q "would be lost\|has rows" /tmp/lb.out; then ok "Level B refuses while columns/budgets hold data: $(grep -m1 -o 'budgets has rows[^\"]*\|client_request_id / wallet_amount[^\"]*' /tmp/lb.out | head -1)"; else bad "Level B did not refuse with data present"; fi
chk "refused Level B dropped nothing" "$($H -At -c "select count(*) from information_schema.columns where table_schema='public' and table_name='debt_payments' and column_name='wallet_amount'")" "1"
# empty DBs: 0001 only  vs  0001 + 0003 + A + B  -> schemas must differ only by the hardened search_path
for X in cyc_base cyc_lvlb; do
  psql $P -q -U postgres -d postgres -c "drop database if exists $X" -c "create database $X owner pgsim" 2>&1 | grep -v NOTICE
  psql $P -q -U postgres -d $X -f "$D/tests/supabase_sim_setup.sql" 2>&1 | grep -v NOTICE
  psql $P -q -U pgsim -d $X -v ON_ERROR_STOP=1 -f "$D/migrations/0001_init.sql" >/dev/null 2>&1
done
psql $P -q -U pgsim -d cyc_lvlb -v ON_ERROR_STOP=1 -f "$D/migrations/0003_phase3_financial.sql" >/dev/null 2>&1
sed "s/^-- set rollback.ui_disabled = 'yes';/set rollback.ui_disabled = 'yes';/" "$D/rollback/0003_rollback.sql" | psql $P -q -U pgsim -d cyc_lvlb -v ON_ERROR_STOP=1 >/dev/null 2>&1; rcA=$?
psql $P -q -U pgsim -d cyc_lvlb -v ON_ERROR_STOP=1 -f /tmp/levelB.sql >/dev/null 2>&1; rcB=$?
chk "Level A+B apply cleanly on an empty DB" "$rcA/$rcB" "0/0"
for X in cyc_base cyc_lvlb; do /usr/lib/postgresql/16/bin/pg_dump $P -U pgsim -s -x -O $X | grep -v '^--' | grep -v '^$' | grep -v 'restrict' > /tmp/sch_$X.sql; done
# the ONLY intended body difference is the cross-currency guard in debt_payment_after_insert (see rollback file)
DIFF=$(diff /tmp/sch_cyc_base.sql /tmp/sch_cyc_lvlb.sql | grep '^[<>]' | grep -v "search_path TO" | grep -v -E "d +debts%rowtype;|wc currency_code;|GUARD|whatever its currency|select currency into wc|if wc is distinct|Cross-currency debt payments are disabled|^> +end if;" | wc -l)
chk "schema after 0003+A+B == pure 0001 except hardened search_path + the documented guard (unexplained diff lines)" "$DIFF" "0"
chk "functions whose search_path differs" "$(diff /tmp/sch_cyc_base.sql /tmp/sch_cyc_lvlb.sql | grep -c "^> .*search_path TO 'public', 'pg_temp'")" "11"

echo; if [ $FAIL -eq 0 ]; then echo "FULL CYCLE: ALL CHECKS PASSED"; else echo "FULL CYCLE: $FAIL CHECK(S) FAILED"; fi; exit $FAIL
