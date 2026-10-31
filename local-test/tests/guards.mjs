// Isolation guards shared by preflight and run.mjs. Pure functions (unit-tested in guards.test.mjs).
export const PROJECT_ID = 'supabase-test-0003';
export const BASE_URL_OK = ['http://127.0.0.1:54321', 'http://localhost:54321'];
export const FORBIDDEN_STRINGS = ['rhsqratwipnyhldxdqyo', 'qdicurevkwntgqhmrzim', '.supabase.co', '.supabase.com', 'sb_secret_'];
const BAD_ENV = /^(SUPABASE_.*(SERVICE|SECRET|ACCESS_TOKEN|DB_PASSWORD|JWT)|.*SERVICE_ROLE.*)$/i;

export function assertSafeEnv(env) {
  const bad = Object.keys(env).filter((k) => BAD_ENV.test(k) && env[k]);
  if (bad.length) throw new Error(`refusing to run: secret-like environment variable(s) set: ${bad.join(', ')} (unset them for this shell)`);
}
export function assertLocalUrl(url) {
  const u = String(url || '').replace(/\/+$/, '');
  if (!BASE_URL_OK.includes(u)) throw new Error(`refusing to run: BASE_URL must be one of ${BASE_URL_OK.join(' | ')}, got "${url}"`);
  return u;
}
function jwtRole(key) {
  const parts = String(key).split('.');
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).role ?? null; } catch { return null; }
}
export function assertAnonKey(key) {
  if (!key || typeof key !== 'string') throw new Error('refusing to run: no anon key');
  if (key.startsWith('sb_secret_')) throw new Error('refusing to run: key is a secret key');
  const role = jwtRole(key);
  if (role !== null && role !== 'anon') throw new Error(`refusing to run: JWT role is "${role}", only "anon" is allowed`);
  if (role === null && !key.startsWith('sb_publishable_')) throw new Error('refusing to run: key is neither an anon JWT nor an sb_publishable_ key');
  return key;
}
export function findForbidden(text) {
  return FORBIDDEN_STRINGS.filter((s) => String(text).includes(s));
}
export function assertTestEmail(email) {
  if (!/^test_[a-z0-9_]+@example\.test$/.test(email)) throw new Error(`refusing to use non-test e-mail "${email}"`);
  return email;
}
export function assertTestName(name) {
  if (!String(name).startsWith('TEST_')) throw new Error(`refusing to create non-test record "${name}"`);
  return name;
}
// Pull ONLY the anon key out of `supabase status -o env`; every other line (including the service key) is ignored.
export function parseAnonKey(statusEnvOutput) {
  const m = String(statusEnvOutput).match(/^ANON_KEY="?([^"\n]+)"?$/m);
  return m ? m[1] : null;
}
