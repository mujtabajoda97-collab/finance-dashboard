/**
 * All financial dates are computed in Dubai time, no matter which timezone the device is in.
 * Dubai (UTC+4) has no daylight-saving time, so a fixed offset is exact.
 * Stored timestamps stay absolute instants (timestamptz / ISO-8601); only the boundaries
 * ("start of month", "end of today") and the display are tied to Dubai.
 */
export const APP_TZ = 'Asia/Dubai';
const OFFSET_MS = 4 * 60 * 60 * 1000;

/** Calendar parts of an instant, as seen in Dubai. month is 1–12. */
export function dubaiParts(d: Date = new Date()) {
  const s = new Date(d.getTime() + OFFSET_MS); // shift, then read with UTC getters
  return {
    year: s.getUTCFullYear(),
    month: s.getUTCMonth() + 1,
    day: s.getUTCDate(),
    hour: s.getUTCHours(),
    minute: s.getUTCMinutes(),
  };
}

/** Instant of Dubai 00:00 on the 1st of the month containing `d` (month offset allowed). */
export function startOfMonthDubai(d: Date = new Date(), monthDelta = 0): Date {
  const p = dubaiParts(d);
  return new Date(Date.UTC(p.year, p.month - 1 + monthDelta, 1) - OFFSET_MS);
}

/** Last millisecond of the current Dubai day. */
export function endOfDayDubai(d: Date = new Date()): Date {
  const p = dubaiParts(d);
  return new Date(Date.UTC(p.year, p.month - 1, p.day + 1) - OFFSET_MS - 1);
}

/** Instant for HH:MM today in Dubai. */
export function dubaiTimeToday(hour: number, minute: number, d: Date = new Date()): Date {
  const p = dubaiParts(d);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, hour, minute) - OFFSET_MS);
}

export function isSameDubaiDay(a: Date, b: Date = new Date()): boolean {
  const x = dubaiParts(a);
  const y = dubaiParts(b);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

/** "HH:MM" one hour from now in Dubai, capped at 23:59 so it stays "today". */
export function nowPlusHourHHMM(d: Date = new Date()): string {
  const later = new Date(d.getTime() + 60 * 60 * 1000);
  if (!isSameDubaiDay(later, d)) return '23:59';
  const p = dubaiParts(later);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** Locale used across the app for Intl formatting (Latin digits). */
export const intlLocale = (lang: 'ar' | 'en') => (lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-AE');

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO instant -> "YYYY-MM-DDTHH:mm" in Dubai time, for <input type="datetime-local">. */
export function toDubaiInput(iso: string | Date): string {
  const p = dubaiParts(typeof iso === 'string' ? new Date(iso) : iso);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** "YYYY-MM-DDTHH:mm" read as Dubai time -> ISO instant. Returns null when malformed. */
export function fromDubaiInput(v: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const ms = Date.UTC(y, mo - 1, d, h, mi) - OFFSET_MS;
  const back = new Date(ms + OFFSET_MS);
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null; // e.g. 31 Feb
  return new Date(ms).toISOString();
}
