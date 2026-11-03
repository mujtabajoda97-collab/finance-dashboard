/**
 * Phone contacts through @capacitor-community/contacts (Android app only), reached at runtime via window.Capacitor.
 * Nothing is sent from here: callers must show the user a confirmation first.
 */
interface RawContact {
  name?: { display?: string | null; given?: string | null; family?: string | null } | null;
  phones?: { number?: string | null }[] | null;
}
interface ContactsPlugin {
  checkPermissions?(): Promise<{ contacts?: string }>;
  requestPermissions?(): Promise<{ contacts?: string }>;
  getContacts(o: { projection: { name?: boolean; phones?: boolean } }): Promise<{ contacts?: RawContact[] }>;
}
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, unknown>;
  registerPlugin?: (name: string) => unknown;
}

export interface ContactHit { name: string; phone: string }
export type ContactsError = 'unsupported' | 'denied' | 'failed';
export class ContactsFail extends Error {
  constructor(public code: ContactsError) {
    super(code);
  }
}

function plugin(): ContactsPlugin | null {
  try {
    const c = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
    if (!c?.isNativePlatform?.()) return null;
    return (c.Plugins?.Contacts ?? c.registerPlugin?.('Contacts') ?? null) as ContactsPlugin | null;
  } catch {
    return null;
  }
}

/** Lower-case, no diacritics, unified alef / ya / ta-marbuta, so «أحمد» finds «احمد». */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every phone number of every contact whose name contains all words of `query`; best matches first. */
export async function findContacts(query: string): Promise<ContactHit[]> {
  const p = plugin();
  if (!p) throw new ContactsFail('unsupported');
  try {
    const perm = (await p.checkPermissions?.())?.contacts;
    if (perm !== 'granted') {
      const asked = (await p.requestPermissions?.())?.contacts;
      if (asked !== 'granted') throw new ContactsFail('denied');
    }
    const res = await p.getContacts({ projection: { name: true, phones: true } });
    const words = norm(query).split(' ').filter(Boolean);
    if (words.length === 0) return [];
    const scored: { hit: ContactHit; score: number }[] = [];
    for (const c of res.contacts ?? []) {
      const name = (c.name?.display ?? `${c.name?.given ?? ''} ${c.name?.family ?? ''}`).trim();
      const n = norm(name);
      if (!n || !words.every((w) => n.includes(w))) continue;
      const score = n === words.join(' ') ? 0 : n.startsWith(words[0]) ? 1 : 2;
      const seen = new Set<string>();
      for (const ph of c.phones ?? []) {
        const num = (ph.number ?? '').trim();
        const key = num.replace(/\D/g, '');
        if (!num || seen.has(key)) continue;
        seen.add(key);
        scored.push({ hit: { name, phone: num }, score });
      }
    }
    return scored.sort((a, b) => a.score - b.score || a.hit.name.localeCompare(b.hit.name)).slice(0, 12).map((s) => s.hit);
  } catch (e) {
    if (e instanceof ContactsFail) throw e;
    const m = String((e as Error)?.message ?? e).toLowerCase();
    throw new ContactsFail(m.includes('permission') || m.includes('denied') ? 'denied' : 'failed');
  }
}
