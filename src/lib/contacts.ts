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
  constructor(public code: ContactsError, public detail = '') {
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

const OK = (v?: string) => v === 'granted' || v === 'limited';

/**
 * Shows the native Android permission pop-up when the permission is not granted yet.
 * The state reported by checkPermissions is not trusted blindly: some devices report 'prompt' / 'denied' although the app was allowed in
 * the phone settings, so callers also try the real read before giving up.
 */
export async function ensureContactsPermission(): Promise<'granted' | 'denied' | 'unsupported'> {
  const p = plugin();
  if (!p) return 'unsupported';
  try {
    if (OK((await p.checkPermissions?.())?.contacts)) return 'granted';
  } catch { /* fall through to the request */ }
  try {
    if (OK((await p.requestPermissions?.())?.contacts)) return 'granted';
  } catch { /* fall through */ }
  try {
    return OK((await p.checkPermissions?.())?.contacts) ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

/** Words that come with the command but are not part of a name. */
const FILLER = new Set(['ل', 'الى', 'الي', 'على', 'عن', 'مع', 'من', 'في', 'ب', 'رسالة', 'رساله', 'واتساب', 'واتس', 'اتصل', 'كلم', 'كلّم', 'ارسل', 'ابعث', 'اتصال', 'بـ', 'لـ', 'يا', 'الاخ', 'الأخ', 'الاستاذ', 'استاذ', 'دارك']);

/** «أحمد طارق، دارك» -> «أحمد طارق»: keep the part before the first separator and drop filler words. */
export function cleanName(q: string): string {
  const first = q.split(/[،,.;؛:!?\n]/)[0] ?? q;
  const kept = first.split(/\s+/).filter((w) => w && !FILLER.has(norm(w)));
  return (kept.length ? kept : first.split(/\s+/)).join(' ').trim();
}

/** Every phone number of every contact that matches the name (phone and Google-synced contacts); best matches first. */
export async function findContacts(query: string): Promise<ContactHit[]> {
  const p = plugin();
  if (!p) throw new ContactsFail('unsupported');
  const read = () => p.getContacts({ projection: { name: true, phones: true } });
  let res: { contacts?: RawContact[] };
  try {
    res = await read(); // try the real read first: it is the truth about the permission
  } catch (first) {
    if ((await ensureContactsPermission()) === 'denied') {
      throw new ContactsFail('denied', String((first as Error)?.message ?? first).slice(0, 160));
    }
    try {
      res = await read();
    } catch (e) {
      const m = String((e as Error)?.message ?? e);
      throw new ContactsFail(/permission|denied/i.test(m) ? 'denied' : 'failed', m.slice(0, 160));
    }
  }
  const qWords = norm(cleanName(query)).split(' ').filter((w) => w && !FILLER.has(w));
  if (qWords.length === 0) return [];
  const scored: { hit: ContactHit; score: number }[] = [];
  for (const c of res.contacts ?? []) {
    const name = (c.name?.display ?? `${c.name?.given ?? ''} ${c.name?.family ?? ''}`).trim();
    const n = norm(name);
    if (!n) continue;
    const nWords = n.split(' ').filter(Boolean);
    const hitsInName = qWords.filter((w) => nWords.some((x) => x.includes(w) || (w.length > 2 && w.includes(x)))).length;
    const nameInQuery = nWords.every((x) => qWords.some((w) => w.includes(x) || x.includes(w)));
    let score = -1;
    if (n === qWords.join(' ')) score = 0;
    else if (hitsInName === qWords.length) score = 1; // every typed word is in the contact name
    else if (nameInQuery && nWords.length >= 2) score = 2; // the whole contact name is inside the typed text
    else if (qWords.length >= 2 && hitsInName >= Math.ceil(qWords.length / 2)) score = 3; // partial overlap
    if (score < 0) continue;
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
}
