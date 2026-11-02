'use client';

import { useEffect, useRef } from 'react';
import { useApp } from './Providers';
import { useData } from '@/lib/data';
import { debtFireAt, taskFireAt } from '@/lib/alertPrefs';
import { isLowWallet, isOpenDebtDue, isTaskOverdue, todayDubai } from '@/lib/derived';
import { markFired, readFlag, sendWhatsApp, showLocalNotification, wasFired } from '@/lib/notify';
import { APP_TZ, dubaiTimeToday, intlLocale } from '@/lib/time';
import { formatMoney } from '@/lib/currency';
import { tx } from '@/lib/text';
import { p2 as px } from '@/lib/ptext2';
import { normalizePhone, readRecipients, type Recipient } from '@/lib/recipient';
import type { Task } from '@/lib/types';

const TICK_MS = 30_000;
const CATCH_UP_MS = 6 * 3600_000; // alerts missed while the app was closed are still delivered for 6 hours
const MAX_SENDS_PER_TICK = 5;

/** Short stable id for a group of alert keys (keeps stored keys small). */
function hashKey(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Runs while the app is open: raises task / debt / low-balance alerts as a system notification and a WhatsApp message. */
export function AlertEngine() {
  const { lang, notify } = useApp();
  const { tasks, debts, wallets, profile } = useData();
  const latest = useRef({ tasks, debts, wallets, profile, lang });
  latest.current = { tasks, debts, wallets, profile, lang };
  const retryAt = useRef<Record<string, number>>({});

  useEffect(() => {
    let stopped = false;

    async function tick() {
      if (stopped) return;
      const { tasks: ts, debts: ds, wallets: ws, profile: pf, lang: lg } = latest.current;
      const T = (k: Parameters<typeof tx>[1]) => tx(lg, k);
      const now = Date.now();
      const waOn = readFlag('auto_wa', false) && !!pf?.whatsapp_phone;
      const remindersOn = readFlag('alert_task24', true);
      const lowOn = readFlag('alert_low', true);
      const dailyOn = readFlag('alert_daily', true);
      const fmt = new Intl.DateTimeFormat(intlLocale(lg), { timeZone: APP_TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      let sends = 0;

      /**
       * Raises one alert for a group of keys: a single system notification and ONE WhatsApp message.
       * A single alert is simply a group of one (group key = member key).
       */
      async function raiseGroup(groupKey: string, members: string[], title: string, body: string, url: string) {
        if (members.some((k) => !wasFired(k))) {
          members.forEach(markFired);
          notify(`${title}: ${body}`, 'warning');
          await showLocalNotification(title, body, groupKey, url);
        }
        const waKey = `wa:${groupKey}`;
        const waPending = members.some((k) => !wasFired(`wa:${k}`));
        if (waOn && waPending && sends < MAX_SENDS_PER_TICK && (retryAt.current[waKey] ?? 0) <= now) {
          sends += 1;
          const res = await sendWhatsApp(`🔔 ${title}\n${body}`);
          if (res.ok) {
            markFired(waKey);
            members.forEach((k) => markFired(`wa:${k}`));
          } else retryAt.current[waKey] = now + 5 * 60_000; // try again in 5 minutes
        }
      }
      /**
       * A reminder the owner wants sent to someone else: the exact text they wrote goes to that number.
       * The owner still gets the normal on-device notification. Needs "automatic WhatsApp" switched on.
       */
      const autoWa = readFlag('auto_wa', false);
      const recs = readRecipients();
      const otherOf = (kind: 'task' | 'debt', id: string): Recipient | null => {
        const r = recs[`${kind}:${id}`];
        return r && r.on && r.text.trim() && normalizePhone(r.phone) ? r : null;
      };
      const otherPending = (key: string) => !wasFired(key) || (autoWa && !wasFired(`wa:other:${key}`));
      async function raiseOther(key: string, rec: Recipient, title: string, body: string, url: string) {
        if (!wasFired(key)) {
          markFired(key);
          notify(`${title}: ${body}`, 'warning');
          await showLocalNotification(title, body, key, url);
        }
        const waKey = `wa:other:${key}`;
        if (autoWa && !wasFired(waKey) && sends < MAX_SENDS_PER_TICK && (retryAt.current[waKey] ?? 0) <= now) {
          sends += 1;
          const res = await sendWhatsApp(rec.text.trim(), rec.phone);
          if (res.ok) markFired(waKey);
          else retryAt.current[waKey] = now + 5 * 60_000;
        }
      }
      const raise = (key: string, title: string, body: string, url: string) => raiseGroup(key, [key], title, body, url);

      if (remindersOn) {
        // Tasks whose reminder time arrived in this round: one task = its own alert, several = ONE summary message.
        const dueTasks: { key: string; t: Task }[] = [];
        for (const t of ts) {
          if (t.is_completed) continue;
          const at = taskFireAt(t);
          if (at === null || now < at || now - at > CATCH_UP_MS) continue;
          const key = `task:${t.id}:${at}`;
          const other = otherOf('task', t.id);
          if (other) {
            if (otherPending(key)) await raiseOther(key, other, T('msgTask'), `${t.title}\n${T('msgDue')}: ${fmt.format(new Date(t.due_date as string))}`, '/tasks/');
            continue;
          }
          if (!wasFired(key) || (waOn && !wasFired(`wa:${key}`))) dueTasks.push({ key, t });
        }
        if (dueTasks.length === 1) {
          const { key, t } = dueTasks[0];
          await raise(key, T('msgTask'), `${t.title}\n${T('msgDue')}: ${fmt.format(new Date(t.due_date as string))}`, '/tasks/');
        } else if (dueTasks.length > 1) {
          const sorted = [...dueTasks].sort((a, b) => new Date(a.t.due_date as string).getTime() - new Date(b.t.due_date as string).getTime());
          const lines = sorted.map(({ t }) => `• ${t.title} — ${fmt.format(new Date(t.due_date as string))}`).join('\n');
          const keys = sorted.map((x) => x.key);
          await raiseGroup(`tasks:${hashKey([...keys].sort().join('|'))}`, keys, `${px(lg, 'msgTasksGroup')} (${sorted.length})`, lines, '/tasks/');
        }
        for (const d of ds) {
          if (!isOpenDebtDue(d)) continue;
          const at = debtFireAt(d);
          if (at === null || now < at || now - at > CATCH_UP_MS) continue;
          const dKey = `debt:${d.id}:${at}`;
          const dTitle = T('msgDebt');
          const dBody = `${d.person_name} — ${formatMoney(d.total_amount - d.paid_amount, d.currency, lg)}\n${T('msgDue')}: ${d.due_date}`;
          const other = otherOf('debt', d.id);
          if (other) await raiseOther(dKey, other, dTitle, dBody, '/debts/');
          else await raise(dKey, dTitle, dBody, '/debts/');
        }
      }

      if (lowOn) {
        // Every wallet under its minimum goes into ONE summary, most critical first.
        const ratio = (w: (typeof ws)[number]) => (w.min_balance_threshold > 0 ? w.balance / w.min_balance_threshold : w.balance);
        const low = ws.filter(isLowWallet).sort((a, b) => ratio(a) - ratio(b));
        if (low.length > 0) {
          const lines = low
            .map((w, i) => `${i + 1}. ${w.name}\n   ${px(lg, 'balNow')}: ${formatMoney(w.balance, w.currency, lg)}\n   ${T('minLabel')}: ${formatMoney(w.min_balance_threshold, w.currency, lg, 0)}`)
            .join('\n');
          const key = `low:${todayDubai()}:${hashKey(low.map((w) => w.id).sort().join(','))}`;
          await raise(key, low.length > 1 ? `${T('msgLow')} (${low.length})` : T('msgLow'), lines, '/finance/');
        }
      }

      if (dailyOn && now >= dubaiTimeToday(9, 0).getTime()) {
        const late = ts
          .filter((t) => isTaskOverdue(t, now))
          .sort((a, b) => new Date(a.due_date as string).getTime() - new Date(b.due_date as string).getTime());
        if (late.length > 0) {
          const shown = late.slice(0, 8).map((t, i) => `${i + 1}. ${t.title}`);
          if (late.length > 8) shown.push(`${px(lg, 'andMore')} ${late.length - 8}`);
          await raise(`daily:${todayDubai()}`, `${T('msgDaily')} (${late.length})`, shown.join('\n'), '/tasks/');
        }
      }
    }

    const first = window.setTimeout(tick, 4_000);
    const timer = window.setInterval(tick, TICK_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [notify]);

  return null;
}
