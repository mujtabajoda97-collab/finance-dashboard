/**
 * Optional fingerprint / screen-lock sign-in for the Android app.
 * The native plugin (capacitor-native-biometric) is reached at runtime through window.Capacitor,
 * never imported, so the website and older app builds simply report "unavailable".
 * Credentials are kept by the plugin in the Android Keystore-backed encrypted storage; the web
 * app only remembers a non-secret "enabled" flag.
 */

const SERVER = 'lifeos.restocloud';
const FLAG = 'bio_enabled';

interface BiometricApi {
  isAvailable(): Promise<{ isAvailable: boolean }>;
  verifyIdentity(o?: { reason?: string; title?: string; subtitle?: string; description?: string; negativeButtonText?: string }): Promise<unknown>;
  setCredentials(o: { username: string; password: string; server: string }): Promise<unknown>;
  getCredentials(o: { server: string }): Promise<{ username: string; password: string }>;
  deleteCredentials(o: { server: string }): Promise<unknown>;
}
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, unknown>;
  registerPlugin?: (name: string) => unknown;
}

function plugin(): BiometricApi | null {
  if (typeof window === 'undefined') return null;
  try {
    const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
    if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return null;
    const p = (cap.Plugins?.NativeBiometric ?? cap.registerPlugin?.('NativeBiometric')) as BiometricApi | undefined;
    return p && typeof p.isAvailable === 'function' ? p : null;
  } catch {
    return null;
  }
}

/** True only inside the Android app, with the plugin installed and a fingerprint / screen lock set up. */
export async function biometricAvailable(): Promise<boolean> {
  const p = plugin();
  if (!p) return false;
  try {
    return !!(await p.isAvailable())?.isAvailable;
  } catch {
    return false;
  }
}

export function biometricEnabled(): boolean {
  try { return localStorage.getItem(FLAG) === '1'; } catch { return false; }
}
function setFlag(on: boolean) {
  try { if (on) localStorage.setItem(FLAG, '1'); else localStorage.removeItem(FLAG); } catch { /* not persisted */ }
}

/** Store the credentials after the user proved the password is right. Throws on failure. */
export async function enableBiometric(email: string, password: string, title: string): Promise<void> {
  const p = plugin();
  if (!p) throw new Error('unavailable');
  await p.verifyIdentity({ title, negativeButtonText: 'Cancel' });
  await p.setCredentials({ username: email, password, server: SERVER });
  setFlag(true);
}

export async function disableBiometric(): Promise<void> {
  setFlag(false);
  try { await plugin()?.deleteCredentials({ server: SERVER }); } catch { /* nothing stored */ }
}

/** Ask for the fingerprint / screen lock and return the saved credentials, or null if cancelled / failed. */
export async function biometricCredentials(title: string): Promise<{ email: string; password: string } | null> {
  const p = plugin();
  if (!p) return null;
  try {
    await p.verifyIdentity({ title, negativeButtonText: 'Cancel' });
    const c = await p.getCredentials({ server: SERVER });
    return c?.username && c?.password ? { email: c.username, password: c.password } : null;
  } catch {
    return null;
  }
}
