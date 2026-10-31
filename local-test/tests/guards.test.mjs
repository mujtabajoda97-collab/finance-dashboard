import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertAnonKey, assertLocalUrl, assertSafeEnv, assertTestEmail, assertTestName, findForbidden, parseAnonKey } from './guards.mjs';
import { summaryFromBuckets } from './summary.mjs';

const jwt = (role) => `x.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.y`;
test('env guard', () => {
  assertSafeEnv({ PATH: '/bin', HOME: '/h', SERVICE: 'x' });
  assert.throws(() => assertSafeEnv({ SUPABASE_SERVICE_ROLE_KEY: 'k' }));
  assert.throws(() => assertSafeEnv({ SUPABASE_ACCESS_TOKEN: 'k' }));
  assert.throws(() => assertSafeEnv({ MY_SERVICE_ROLE: 'k' }));
});
test('url guard accepts only local API', () => {
  assert.equal(assertLocalUrl('http://127.0.0.1:54321/'), 'http://127.0.0.1:54321');
  for (const u of ['https://rhsqratwipnyhldxdqyo.supabase.co', 'http://127.0.0.1:54322', 'http://example.com', '', undefined])
    assert.throws(() => assertLocalUrl(u));
});
test('key guard', () => {
  assertAnonKey(jwt('anon')); assertAnonKey('sb_publishable_abc');
  assert.throws(() => assertAnonKey(jwt('service_role')));
  assert.throws(() => assertAnonKey('sb_secret_abc'));
  assert.throws(() => assertAnonKey('garbage'));
  assert.throws(() => assertAnonKey(''));
});
test('only ANON_KEY is parsed from supabase status', () => {
  const out = 'API_URL="http://127.0.0.1:54321"\nANON_KEY="aaa.bbb.ccc"\nSERVICE_ROLE_KEY="zzz.yyy.xxx"\nJWT_SECRET="s"\n';
  assert.equal(parseAnonKey(out), 'aaa.bbb.ccc');
  assert.equal(parseAnonKey('SERVICE_ROLE_KEY="z"'), null);
});
test('forbidden strings / test names', () => {
  assert.deepEqual(findForbidden('url=https://rhsqratwipnyhldxdqyo.supabase.co'), ['rhsqratwipnyhldxdqyo', '.supabase.co']);
  assert.deepEqual(findForbidden('http://127.0.0.1:54321'), []);
  assertTestEmail('test_a@example.test'); assert.throws(() => assertTestEmail('me@gmail.com'));
  assertTestName('TEST_W1'); assert.throws(() => assertTestName('Salary'));
});
test('run.mjs aggregator matches the app (src/lib/stats.ts) on the committed DB-produced fixture', () => {
  const fx = JSON.parse(readFileSync(new URL('../../tests/fixtures/ui_month.json', import.meta.url), 'utf8'));
  const s = summaryFromBuckets(fx.buckets, { AED: 1, SDG: 160, USD: 0.27229 });
  assert.ok(Math.abs(s.income - 5000) < 0.005 && Math.abs(s.expenses - 310) < 0.005 && Math.abs(s.sudan - 800) < 0.005 && Math.abs(s.net - 3890) < 0.005 && s.count === 4);
});
