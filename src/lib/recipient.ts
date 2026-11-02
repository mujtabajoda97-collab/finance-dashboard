import type { Lang } from './i18n';
import { p2 } from './ptext2';

/** "Send this reminder to someone else" settings of one task or debt. Kept on this device (like the debt alert timing). */
export interface Recipient {
  on: boolean;
  name: string;
  phone: string;
  /** The exact message that is sent. */
  text: string;
}
export type RecipientKind = 'task' | 'debt';

export const emptyRecipient = (): Recipient => ({ on: false, name: '', phone: '', text: '' });

const KEY = 'wa_other_v1';
type Stored = Record<string, Recipient>;

function readAll(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored) : {};
  } catch {
    return {};
  }
}

export const recipientKey = (kind: RecipientKind, id: string) => `${kind}:${id}`;

export function getRecipient(kind: RecipientKind, id: string): Recipient {
  const r = readAll()[recipientKey(kind, id)];
  return r ? { on: !!r.on, name: r.name ?? '', phone: r.phone ?? '', text: r.text ?? '' } : emptyRecipient();
}

/** Every saved recipient, keyed "task:<id>" / "debt:<id>" (read once per alert round). */
export const readRecipients = readAll;

export function setRecipient(kind: RecipientKind, id: string, r: Recipient): void {
  try {
    const all = readAll();
    if (r.on) all[recipientKey(kind, id)] = r;
    else delete all[recipientKey(kind, id)];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* private mode: not persisted */
  }
}

/** Digits with country code, or null when the number cannot be a WhatsApp number (same rules as the server). */
export function normalizePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (/^05\d{8}$/.test(d)) d = `971${d.slice(1)}`;
  if (d.length < 8 || d.length > 15 || d.startsWith('0')) return null;
  return d;
}

const fill = (tpl: string, vars: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');

/** Friendly starting text. Name / amount / title are replaced here; afterwards it is plain text the user can rewrite. */
export function suggestedText(kind: RecipientKind, lang: Lang, v: { name: string; amount?: string; title?: string }): string {
  const name = v.name.trim() || p2(lang, 'tplNameFallback');
  return fill(p2(lang, kind === 'debt' ? 'tplDebt' : 'tplTask'), { name, amount: v.amount ?? '', title: v.title?.trim() || '…' });
}

/** Returns an error key (for p2) when an enabled recipient is not sendable, otherwise null. */
export function recipientError(r: Recipient): 'recipPhoneBad' | 'recipTextEmpty' | null {
  if (!r.on) return null;
  if (!normalizePhone(r.phone)) return 'recipPhoneBad';
  if (!r.text.trim()) return 'recipTextEmpty';
  return null;
}
