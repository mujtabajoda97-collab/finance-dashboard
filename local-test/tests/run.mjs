// HTTP integration tests against the LOCAL Supabase CLI stack (PostgREST + GoTrue). Anon key only.
// Run via scripts/run-all.sh (which runs preflight first). Exits non-zero on any failed check.
import { execFileSync } from 'node:child_process';
import { assertAnonKey, assertLocalUrl, assertSafeEnv, assertTestEmail, assertTestName, PROJECT_ID } from './guards.mjs';
import { summaryFromBuckets } from './summary.mjs';

assertSafeEnv(process.env);
const BASE = assertLocalUrl(process.env.BASE_URL || 'http://127.0.0.1:54321');
const ANON = assertAnonKey(process.env.ANON_KEY);
const DB_CONTAINER = `supabase_db_${PROJECT_ID}`;
const PASSWORD = 'Test-only-pw-0003!';
console.log(`target: ${BASE}  (local stack "${PROJECT_ID}")`);

// ---------- helpers ----------
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✘ ${name} ${detail ? '— ' + detail : ''}`); }
}
async function http(method, url, { token, body, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    headers: { apikey: ANON, Authorization: `Bearer ${token || ANON}`, 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}
const rest = (method, path, token, body, prefer) =>
  http(method, `${BASE}/rest/v1/${path}`, { token, body, headers: prefer ? { Prefer: prefer } : {} });
const rpc = (fn, token, args = {}) => http('POST', `${BASE}/rest/v1/rpc/${fn}`, { token, body: args });
const ok2xx = (r) => r.status >= 200 && r.status < 300;
const denied = (r) => [401, 403, 404].includes(r.status);
const msg = (r) => (r.json && (r.json.message || r.json.hint || JSON.stringify(r.json))) || String(r.status);
const sql = (q) => execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', q], { encoding: 'utf8' }).trim();
const uuid = () => crypto.randomUUID();

async function signUp(email) {
  assertTestEmail(email);
  let r = await http('POST', `${BASE}/auth/v1/signup`, { body: { email, password: PASSWORD } });
  if (!r.json?.access_token) r = await http('POST', `${BASE}/auth/v1/token?grant_type=password`, { body: { email, password: PASSWORD } });
  if (!r.json?.access_token) throw new Error(`cannot obtain a session for ${email}: ${msg(r)}`);
  return { token: r.json.access_token, id: r.json.user.id };
}
async function mkWallet(tok, name, currency, opening = 0) {
  assertTestName(name);
  const r = await rest('POST', 'wallets', tok, { name, currency, opening_balance: opening }, 'return=representation');
  if (!ok2xx(r)) throw new Error(`wallet ${name}: ${msg(r)}`);
  return r.json[0];
}
async function bal(tok, id) { const r = await rest('GET', `wallets?id=eq.${id}&select=balance`, tok); return Number(r.json[0].balance); }
async function debt(tok, id) { const r = await rest('GET', `debts?id=eq.${id}&select=paid_amount,status`, tok); return { paid: Number(r.json[0].paid_amount), status: r.json[0].status }; }
async function mkDebt(tok, person, type, currency, total) {
  assertTestName(person);
  const r = await rest('POST', 'debts', tok, { person_name: person, type, currency, total_amount: total }, 'return=representation');
  if (!ok2xx(r)) throw new Error(`debt ${person}: ${msg(r)}`);
  return r.json[0];
}
const pay = (tok, debt_id, wallet_id, amount, wallet_amount, extra = {}) =>
  rest('POST', 'debt_payments', tok, { debt_id, wallet_id, amount, ...(wallet_amount === undefined ? {} : { wallet_amount }), ...extra }, 'return=representation');
const near = (a, b) => Math.abs(a - b) < 0.005;

// ---------- preconditions ----------
console.log('\n== 0. preconditions ==');
const startRows = sql("select (select count(*) from auth.users)+(select count(*) from public.wallets)+(select count(*) from public.transactions)+(select count(*) from public.debts)+(select count(*) from public.debt_payments)");
check('local database starts empty (no users, wallets, transactions, debts)', startRows === '0', `rows=${startRows}`);
if (startRows !== '0') { console.log('refusing to continue on a non-empty database'); process.exit(2); }
check('PostgreSQL major version is 17', sql('show server_version_num').startsWith('17'), sql('show server_version'));

const A = await signUp('test_a@example.test');
const B = await signUp('test_b@example.test');
check('two synthetic users created through GoTrue (anon key only)', !!A.token && !!B.token);

// ---------- 1. permissions ----------
console.log('\n== 1. permission matrix (REST) ==');
const anonWallets = await rest('GET', 'wallets?select=id', null);
check('anon sees no wallet rows (401/403 after 0004, or [] via RLS before it)', denied(anonWallets) || (ok2xx(anonWallets) && anonWallets.json.length === 0), `status=${anonWallets.status}`);
for (const t of ['budgets', 'wallet_reconciliation'])
  check(`anon cannot read ${t}`, denied(await rest('GET', `${t}?select=*`, null)));
check('anon cannot call rpc/month_summary', denied(await rpc('month_summary', null, { p_from: '2000-01-01', p_to: '2100-01-01' })));
for (const [fn, args] of [['recompute_wallet_balances', {}], ['debt_recalc', { p_debt_id: uuid() }], ['transaction_validate', {}], ['wallet_expected_balance', { p_wallet: uuid() }].slice(0, 0)].filter(Boolean))
  check(`authenticated cannot call rpc/${fn}`, denied(await rpc(fn, A.token, args)) || (await rpc(fn, A.token, args)).status >= 400);
check('authenticated CAN call rpc/month_summary', ok2xx(await rpc('month_summary', A.token, { p_from: '2000-01-01', p_to: '2100-01-01' })));

// ---------- 2. wallets & transactions ----------
console.log('\n== 2. wallets, income/expense, transfers ==');
const W1 = await mkWallet(A.token, 'TEST_W1', 'AED', 1000);
const W2 = await mkWallet(A.token, 'TEST_W2', 'AED', 0);
const W3 = await mkWallet(A.token, 'TEST_W3', 'SDG', 0);
check('opening balance sets balance', (await bal(A.token, W1.id)) === 1000);
await rest('PATCH', `wallets?id=eq.${W1.id}`, A.token, { balance: 999999 });
check('client cannot set balance by hand', (await bal(A.token, W1.id)) === 1000);
const txn = (tok, row) => rest('POST', 'transactions', tok, row, 'return=representation');
let r = await txn(A.token, { wallet_id: W1.id, type: 'INCOME', category: 'SALARY', amount: 500 });
check('income adds', ok2xx(r) && (await bal(A.token, W1.id)) === 1500, msg(r));
r = await txn(A.token, { wallet_id: W1.id, type: 'EXPENSE', category: 'FOOD', amount: 100 });
check('expense subtracts', ok2xx(r) && (await bal(A.token, W1.id)) === 1400, msg(r));
r = await txn(A.token, { wallet_id: W1.id, to_wallet_id: W1.id, type: 'TRANSFER', amount: 10 });
check('transfer to the same wallet is rejected', !ok2xx(r) && (await bal(A.token, W1.id)) === 1400, msg(r));
r = await txn(A.token, { wallet_id: W1.id, to_wallet_id: W2.id, type: 'EXPENSE', amount: 10 });
check('to_wallet_id on a non-transfer is rejected', !ok2xx(r), msg(r));
r = await txn(A.token, { wallet_id: W1.id, to_wallet_id: W3.id, type: 'TRANSFER', amount: 100 });
check('cross-currency transfer without to_amount is rejected', !ok2xx(r) && /to_amount/i.test(msg(r)), msg(r));
r = await txn(A.token, { wallet_id: W1.id, to_wallet_id: W3.id, type: 'TRANSFER', category: 'INTERNAL_TRANSFER', amount: 100, to_amount: 6000 });
check('cross-currency transfer with to_amount moves both sides', ok2xx(r) && (await bal(A.token, W1.id)) === 1300 && (await bal(A.token, W3.id)) === 6000, msg(r));
r = await txn(A.token, { wallet_id: W1.id, to_wallet_id: W2.id, type: 'TRANSFER', category: 'INTERNAL_TRANSFER', amount: 50 });
check('same-currency transfer', ok2xx(r) && (await bal(A.token, W1.id)) === 1250 && (await bal(A.token, W2.id)) === 50, msg(r));
r = await txn(A.token, { wallet_id: W1.id, type: 'TRANSFER', category: 'SUDAN_TRANSFER', amount: 30 });
check('Sudan transfer debits the source only', ok2xx(r) && (await bal(A.token, W1.id)) === 1220 && (await bal(A.token, W2.id)) === 50, msg(r));
await rest('PATCH', `wallets?id=eq.${W2.id}`, A.token, { is_archived: true });
r = await txn(A.token, { wallet_id: W2.id, type: 'EXPENSE', amount: 1 });
check('posting to an archived wallet is rejected', !ok2xx(r), msg(r));
await rest('PATCH', `wallets?id=eq.${W2.id}`, A.token, { is_archived: false });
r = await rest('PATCH', `wallets?id=eq.${W1.id}`, A.token, { currency: 'USD' });
check('wallet currency is frozen once it has history', !ok2xx(r), msg(r));
const req = uuid();
const t1 = await txn(A.token, { wallet_id: W1.id, type: 'EXPENSE', category: 'FOOD', amount: 20, client_request_id: req });
const t2 = await txn(A.token, { wallet_id: W1.id, type: 'EXPENSE', category: 'FOOD', amount: 20, client_request_id: req });
check('duplicate client_request_id returns 409 / 23505 and posts once', ok2xx(t1) && t2.status === 409 && t2.json?.code === '23505' && (await bal(A.token, W1.id)) === 1200, `${t2.status} ${msg(t2)}`);

// ---------- 3. isolation ----------
console.log('\n== 3. isolation between users ==');
check('user B sees none of A\'s wallets or transactions', (await rest('GET', 'wallets?select=id', B.token)).json.length === 0 && (await rest('GET', 'transactions?select=id', B.token)).json.length === 0);
const BW = await mkWallet(B.token, 'TEST_BW', 'AED', 0);
r = await txn(B.token, { wallet_id: W1.id, type: 'EXPENSE', amount: 5 });
check('B cannot post into A\'s wallet', !ok2xx(r) && (await bal(A.token, W1.id)) === 1200, msg(r));
r = await txn(B.token, { wallet_id: BW.id, to_wallet_id: W1.id, type: 'TRANSFER', amount: 5 });
check('B cannot transfer into A\'s wallet', !ok2xx(r) && (await bal(A.token, W1.id)) === 1200, msg(r));

// ---------- 4. debts ----------
console.log('\n== 4. debts and repayments ==');
const DA = await mkDebt(A.token, 'TEST_D_AED', 'PAYABLE', 'AED', 100);
r = await rest('PATCH', `debts?id=eq.${DA.id}`, A.token, { paid_amount: 50 });
check('client cannot hand-edit paid_amount', !ok2xx(r) && (await debt(A.token, DA.id)).paid === 0, msg(r));
r = await rest('PATCH', `debts?id=eq.${DA.id}`, A.token, { status: 'PAID' });
check('client cannot hand-edit status', !ok2xx(r) && (await debt(A.token, DA.id)).status === 'OPEN', msg(r));
r = await pay(A.token, DA.id, W1.id, 40);
check('same-currency installment: wallet -40, debt 40/100 PARTIAL', ok2xx(r) && (await bal(A.token, W1.id)) === 1160 && (await debt(A.token, DA.id)).paid === 40 && (await debt(A.token, DA.id)).status === 'PARTIAL', msg(r));
const payId = r.json?.[0]?.id;
r = await pay(A.token, DA.id, W1.id, 61);
check('over-payment is rejected and changes nothing', !ok2xx(r) && (await bal(A.token, W1.id)) === 1160, msg(r));
r = await rest('PATCH', `transactions?debt_payment_id=eq.${payId}`, A.token, { amount: 1 }, 'return=representation');
check('client cannot edit the wallet transaction of a repayment', (await rest('GET', `transactions?debt_payment_id=eq.${payId}&select=amount`, A.token)).json[0].amount == 40, msg(r));
await rest('DELETE', `transactions?debt_payment_id=eq.${payId}`, A.token);
check('client cannot delete the wallet transaction of a repayment', (await rest('GET', `transactions?debt_payment_id=eq.${payId}&select=id`, A.token)).json.length === 1);
r = await txn(A.token, { wallet_id: W1.id, type: 'EXPENSE', amount: 1, debt_payment_id: payId });
check('client cannot insert a transaction linked to a repayment', !ok2xx(r), msg(r));
r = await rest('DELETE', `debt_payments?id=eq.${payId}`, A.token);
check('deleting the installment restores wallet and debt', (await bal(A.token, W1.id)) === 1200 && (await debt(A.token, DA.id)).paid === 0, msg(r));

// multi-currency: SDG debt, AED wallet
const DS = await mkDebt(A.token, 'TEST_D_SDG', 'PAYABLE', 'SDG', 160000);
const MA = await mkWallet(A.token, 'TEST_MA', 'AED', 1000);
const MS = await mkWallet(A.token, 'TEST_MS', 'SDG', 200000);
r = await pay(A.token, DS.id, MA.id, 16000, 100);
let dtx = (await rest('GET', `transactions?debt_payment_id=eq.${r.json?.[0]?.id}&select=type,category,amount,original_amount,original_currency,exchange_rate_used`, A.token)).json?.[0] || {};
check('SDG debt / AED wallet: wallet -100 AED, debt +16000 SDG, tx records original 16000 SDG @0.00625',
  ok2xx(r) && (await bal(A.token, MA.id)) === 900 && (await debt(A.token, DS.id)).paid === 16000 && Number(dtx.amount) === 100 && Number(dtx.original_amount) === 16000 && dtx.original_currency === 'SDG' && Number(dtx.exchange_rate_used) === 0.00625 && dtx.type === 'EXPENSE' && dtx.category === 'DEBT', JSON.stringify(dtx) + msg(r));
r = await pay(A.token, DS.id, MA.id, 32000, 210);
check('second installment at another rate: wallet 690, debt 48000', ok2xx(r) && (await bal(A.token, MA.id)) === 690 && (await debt(A.token, DS.id)).paid === 48000, msg(r));
r = await pay(A.token, DS.id, MA.id, 112000.01, 1);
check('112000.01 SDG exceeds the SDG remainder (even for 1 AED)', !ok2xx(r) && (await bal(A.token, MA.id)) === 690, msg(r));
r = await pay(A.token, DS.id, MA.id, 112000, 600);
const lastId = r.json?.[0]?.id;
check('exact remainder settles the debt (PAID), wallet 90', ok2xx(r) && (await debt(A.token, DS.id)).status === 'PAID' && (await bal(A.token, MA.id)) === 90, msg(r));
await rest('DELETE', `debt_payments?id=eq.${lastId}`, A.token);
check('deleting that installment returns exactly 600 AED and re-opens 112000 SDG', (await bal(A.token, MA.id)) === 690 && (await debt(A.token, DS.id)).status === 'PARTIAL');
r = await pay(A.token, DS.id, MA.id, 10);
check('cross-currency without wallet_amount is rejected', !ok2xx(r) && /wallet_amount/i.test(msg(r)), msg(r));
r = await pay(A.token, DS.id, MA.id, 10, 0);
check('wallet_amount = 0 is rejected', !ok2xx(r), msg(r));

// AED debt, SDG wallet (and receivable)
const DE = await mkDebt(A.token, 'TEST_D_AED2', 'PAYABLE', 'AED', 1000);
r = await pay(A.token, DE.id, MS.id, 100, 16000);
check('AED debt / SDG wallet: wallet -16000 SDG, debt +100 AED', ok2xx(r) && (await bal(A.token, MS.id)) === 184000 && (await debt(A.token, DE.id)).paid === 100, msg(r));
const RE = await mkDebt(A.token, 'TEST_R_AED', 'RECEIVABLE', 'AED', 500);
r = await pay(A.token, RE.id, MS.id, 50, 8100);
check('AED receivable collected into an SDG wallet: wallet +8100 SDG, debt +50 AED', ok2xx(r) && (await bal(A.token, MS.id)) === 192100 && (await debt(A.token, RE.id)).paid === 50, msg(r));
const rid = uuid();
const p1 = await pay(A.token, DE.id, MS.id, 5, 800, { client_request_id: rid });
const p2 = await pay(A.token, DE.id, MS.id, 5, 800, { client_request_id: rid });
check('duplicate installment (same client_request_id) is rejected once', ok2xx(p1) && p2.status === 409, `${p2.status} ${msg(p2)}`);

// concurrency: two simultaneous installments for the full remainder
const DC = await mkDebt(A.token, 'TEST_D_CONC', 'PAYABLE', 'AED', 100);
const [c1, c2] = await Promise.all([pay(A.token, DC.id, W1.id, 60), pay(A.token, DC.id, W1.id, 60)]);
check('two simultaneous 60 AED installments on a 100 AED debt: exactly one succeeds', [c1, c2].filter(ok2xx).length === 1 && (await debt(A.token, DC.id)).paid === 60, `${c1.status}/${c2.status}`);

// ---------- 5. month_summary ----------
console.log('\n== 5. month_summary vs the app\'s rules (user C, synthetic October 2026) ==');
const C = await signUp('test_c@example.test');
const UA = await mkWallet(C.token, 'TEST_UA', 'AED', 10000), UA2 = await mkWallet(C.token, 'TEST_UA2', 'AED', 0);
const US = await mkWallet(C.token, 'TEST_US', 'SDG', 100000), UU = await mkWallet(C.token, 'TEST_UU', 'USD', 0);
const T = (row) => txn(C.token, row);
await T({ wallet_id: UA.id, type: 'INCOME', category: 'SALARY', amount: 5000, date: '2026-10-03T09:00:00+04:00' });
await T({ wallet_id: UA.id, type: 'EXPENSE', category: 'FOOD', amount: 300, date: '2026-10-05T13:00:00+04:00' });
await T({ wallet_id: US.id, type: 'EXPENSE', category: 'TRANSPORT', amount: 1600, date: '2026-10-06T08:00:00+04:00' });
await T({ wallet_id: UA.id, to_wallet_id: UA2.id, type: 'TRANSFER', category: 'INTERNAL_TRANSFER', amount: 200, date: '2026-10-07T10:00:00+04:00' });
await T({ wallet_id: UA.id, to_wallet_id: UU.id, type: 'TRANSFER', category: 'INTERNAL_TRANSFER', amount: 367.25, to_amount: 100, date: '2026-10-08T10:00:00+04:00' });
await T({ wallet_id: UA.id, type: 'TRANSFER', category: 'SUDAN_TRANSFER', amount: 800, date: '2026-10-09T10:00:00+04:00' });
const UD1 = await mkDebt(C.token, 'TEST_U_P1', 'PAYABLE', 'AED', 1000), UD2 = await mkDebt(C.token, 'TEST_U_R1', 'RECEIVABLE', 'AED', 500), UD3 = await mkDebt(C.token, 'TEST_U_P2', 'PAYABLE', 'USD', 100);
await pay(C.token, UD1.id, UA.id, 400, undefined, { payment_date: '2026-10-10T10:00:00+04:00' });
await pay(C.token, UD2.id, UA.id, 200, undefined, { payment_date: '2026-10-11T10:00:00+04:00' });
await pay(C.token, UD3.id, UA.id, 50, 183.63, { payment_date: '2026-10-12T10:00:00+04:00' });
await T({ wallet_id: UA.id, type: 'INCOME', category: 'SALARY', amount: 777, date: '2026-09-30T23:59:00+04:00' });
await T({ wallet_id: UA.id, type: 'EXPENSE', category: 'FOOD', amount: 999, date: '2026-11-01T00:00:00+04:00' });
r = await rpc('month_summary', C.token, { p_from: '2026-10-01T00:00:00+04:00', p_to: '2026-11-01T00:00:00+04:00' });
const s = summaryFromBuckets(r.json || [], { AED: 1, SDG: 160, USD: 0.27229 });
check('month_summary → income 5000, expenses 310, Sudan 800, net 3890, count 4 (DEBT and internal transfers excluded; Dubai month bounds)',
  ok2xx(r) && near(s.income, 5000) && near(s.expenses, 310) && near(s.sudan, 800) && near(s.net, 3890) && s.count === 4, JSON.stringify(s));
check('DEBT repayments are present as DEBT buckets in wallet currency (AED 583.63 out, 200 in) so the app can show them separately',
  near((r.json || []).filter((b) => b.category === 'DEBT' && b.txn_type === 'EXPENSE').reduce((a, b) => a + Number(b.total), 0), 583.63) && near((r.json || []).filter((b) => b.category === 'DEBT' && b.txn_type === 'INCOME').reduce((a, b) => a + Number(b.total), 0), 200));
const uaBal = await bal(C.token, UA.id);
check('wallet UA balance matches the hand computation (12727.12)', near(uaBal, 12727.12), String(uaBal));

// ---------- 6. database-side invariants ----------
console.log('\n== 6. database invariants (superuser inside the local container) ==');
check('wallet_reconciliation: zero drift for every wallet', sql('select count(*) from public.wallet_reconciliation where drift <> 0') === '0');
check('all SECURITY DEFINER functions pin search_path = public, pg_temp', sql("select count(*) from pg_proc where pronamespace='public'::regnamespace and prosecdef and not (coalesce(proconfig,'{}') @> array['search_path=public, pg_temp'])") === '0');
check('no SECURITY DEFINER function is executable by anon or authenticated', sql("select count(*) from pg_proc p where pronamespace='public'::regnamespace and prosecdef and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))") === '0');
check('no data outside the TEST_ namespace', sql("select count(*) from public.wallets where name not like 'TEST\\_%'") === '0');

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
if (failed) { console.log('FAILED:\n - ' + failures.join('\n - ')); process.exit(1); }
