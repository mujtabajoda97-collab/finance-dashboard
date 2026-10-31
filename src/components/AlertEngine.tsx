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

const TICK_MS = 30_000;
const CATCH_UP_MS = 6 * 3600_000; // alerts missed while the app was closed are still delivered for 6 hours
const MAX_SENDS_PER_TICK = 5;

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

      async function raise(key: string, title: string, body: string, url: string) {
        if (!wasFired(key)) {
          markFired(key);
          notify(`${title}: ${body}`, 'warning');
          await showLocalNotification(title, body, key, url);
        }
        const waKey = `wa:${key}`;
        if (waOn && !wasFired(waKey) && sends < MAX_SENDS_PER_TICK && (retryAt.current[waKey] ?? 0) <= now) {
          sends += 1;
          const res = await sendWhatsApp(`🔔 ${title}\n${body}`);
          if (res.ok) markFired(waKey);
          else retryAt.current[waKey] = now + 5 * 60_000; // try again in 5 minutes
        }
      }

      if (remindersOn) {
        for (const t of ts) {
          if (t.is_completed) continue;
          const at = taskFireAt(t);
          if (at === null || now < at || now - at > CATCH_UP_MS) continue;
          await raise(`task:${t.id}:${at}`, T('msgTask'), `${t.title}\n${T('msgDue')}: ${fmt.format(new Date(t.due_date as string))}`, '/tasks/');
        }
        for (const d of ds) {
          if (!isOpenDebtDue(d)) continue;
          const at = debtFireAt(d);
          if (at === null || now < at || now - at > CATCH_UP_MS) continue;
          await raise(`debt:${d.id}:${at}`, T('msgDebt'), `${d.person_name} — ${formatMoney(d.total_amount - d.paid_amount, d.currency, lg)}\n${T('msgDue')}: ${d.due_date}`, '/debts/');
        }
      }

      if (lowOn) {
        for (const w of ws) {
          if (!isLowWallet(w)) continue;
          await raise(`low:${w.id}:${todayDubai()}`, T('msgLow'), `${w.name}: ${formatMoney(w.balance, w.currency, lg)} (${T('minLabel')} ${formatMoney(w.min_balance_threshold, w.currency, lg, 0)})`, '/finance/');
        }
      }

      if (dailyOn && now >= dubaiTimeToday(9, 0).getTime()) {
        const late = ts.filter((t) => isTaskOverdue(t, now));
        if (late.length > 0) {
          const list = late.slice(0, 5).map((t) => `• ${t.title}`).join('\n');
          await raise(`daily:${todayDubai()}`, `${T('msgDaily')} (${late.length})`, list, '/tasks/');
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
