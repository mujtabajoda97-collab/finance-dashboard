import { supabase } from './supabase';
import { normalizePhone } from './recipient';

export type PermissionState = NotificationPermission | 'unsupported';

export const notifSupported = () => typeof window !== 'undefined' && 'Notification' in window;
export const notifPermission = (): PermissionState => (notifSupported() ? Notification.permission : 'unsupported');

/** Must be called from a user gesture (a button press). */
export async function requestNotifPermission(): Promise<PermissionState> {
  if (!notifSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** Shows a system notification through the service worker, so it also appears in the OS notification shade. */
export async function showLocalNotification(title: string, body: string, tag: string, url = '/'): Promise<boolean> {
  if (notifPermission() !== 'granted') return false;
  const options: NotificationOptions = { body, tag, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', dir: 'auto', data: { url } };
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) {
      await reg.showNotification(title, options);
      return true;
    }
    new Notification(title, options);
    return true;
  } catch {
    return false;
  }
}

/** Sends a WhatsApp message to the number saved in the signed-in user's profile, or to `to` when given (server route + Green API). */
export interface WaRef { kind: 'task' | 'debt'; ids: string[] }

export async function sendWhatsApp(text: string, to?: string, ref?: WaRef): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data } = await supabase().auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { ok: false, error: 'no-session' };
    const res = await fetch('/api/whatsapp/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(to ? { text, to } : { text }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (res.ok && body.ok && ref && ref.ids.length > 0) void recordOutbox(data.session!.user.id, text, to, ref);
    return res.ok && body.ok ? { ok: true } : { ok: false, error: body.error ?? `http-${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network' };
  }
}

export function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

// ---- "already notified" log, shared by every open tab ----
const FIRED = 'alerts_fired_v1';
const KEEP_MS = 7 * 86_400_000;

function readFired(): Record<string, number> {
  try {
    const raw = localStorage.getItem(FIRED);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}
export const wasFired = (key: string) => key in readFired();
export function markFired(key: string): void {
  try {
    const now = Date.now();
    const all = readFired();
    all[key] = now;
    for (const k of Object.keys(all)) if (now - all[k] > KEEP_MS) delete all[k];
    localStorage.setItem(FIRED, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

/**
 * Remembers which task / debt a sent message was about, so a WhatsApp reply ("تم", a debtor's answer) can be matched
 * by the webhook. Best effort: the table only exists after SQL 0011, and any failure is ignored.
 */
async function recordOutbox(uid: string, text: string, to: string | undefined, ref: WaRef): Promise<void> {
  try {
    const sb = supabase();
    let phone = to ? normalizePhone(to) : null;
    if (!phone) {
      const { data } = await sb.from('profiles').select('whatsapp_phone').maybeSingle();
      phone = data?.whatsapp_phone ? normalizePhone(String(data.whatsapp_phone)) : null;
    }
    if (!phone) return;
    await sb.from('wa_outbox').insert({ user_id: uid, kind: ref.kind, ref_ids: ref.ids, chat_phone: phone, message: text.slice(0, 1000), is_own_number: !to });
  } catch {
    /* ignore */
  }
}
