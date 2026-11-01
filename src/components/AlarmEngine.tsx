'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BellRing } from 'lucide-react';
import { useApp } from './Providers';
import { useData } from '@/lib/data';
import {
  ackAlarm, ackKey, alarmPlan, buildAlarmItems, dueNow, ensureAlarmChannel, ensureAlarmPermission, isNativeApp,
  nativeNotifications, readAcked, seriesOf, syncNativeAlarms, TEST_EVENT, type AlarmItem,
} from '@/lib/alarm';
import { px } from '@/lib/ptext';
import { tx } from '@/lib/text';

/**
 * Keeps the voice alarms in sync.
 *  - Android app: schedules repeating alarm notifications on the phone (they ring with the app closed).
 *  - Browser: rings inside the open app (looping tone + full-screen stop button).
 */
export function AlarmEngine() {
  const { lang } = useApp();
  const router = useRouter();
  const { tasks, debts, projects, cashflows } = useData();
  const [now, setNow] = useState(() => Date.now());
  const [native, setNative] = useState(false);
  const [test, setTest] = useState<AlarmItem | null>(null);
  const [ackV, setAckV] = useState(0);

  useEffect(() => {
    setNative(isNativeApp());
    const id = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  const labels = useMemo(
    () => ({ lang, task: tx(lang, 'msgTask'), debt: tx(lang, 'msgDebt'), flow: px(lang, 'alarmProjectItem') }),
    [lang],
  );
  const items = useMemo(
    () => buildAlarmItems({ tasks, debts, projects, cashflows }, labels, now),
    [tasks, debts, projects, cashflows, labels, now],
  );
  const signature = items.map((i) => `${ackKey(i.key, i.at)}|${i.body}`).join('\n') + `#${ackV}`;
  const latest = useRef(items);
  latest.current = items;

  // ---- Android app: (re)schedule on the phone whenever the set of alarms changes ----
  useEffect(() => {
    const ln = nativeNotifications();
    if (!ln) return;
    let cancelled = false;
    (async () => {
      try {
        await ensureAlarmChannel(ln);
        const plan = alarmPlan(latest.current, Date.now(), readAcked());
        if (plan.length > 0 && !(await ensureAlarmPermission(ln, true))) return;
        if (!cancelled) await syncNativeAlarms(ln, plan);
      } catch {
        /* the plugin is not available in this build: nothing to schedule */
      }
    })();
    return () => { cancelled = true; };
  }, [signature]);

  // Opening an alarm notification stops the rest of its series.
  useEffect(() => {
    const ln = nativeNotifications();
    if (!ln) return;
    let handle: { remove(): Promise<void> } | null = null;
    let gone = false;
    ln.addListener('localNotificationActionPerformed', (e) => {
      const n = e.notification;
      if (!n || typeof n.id !== 'number') return;
      if (n.extra?.key && typeof n.extra.at === 'number') ackAlarm(n.extra.key, n.extra.at);
      void ln.cancel({ notifications: seriesOf(n.id).map((id) => ({ id })) }).catch(() => undefined);
      setAckV((v) => v + 1);
      if (n.extra?.url) router.push(n.extra.url);
    }).then((h) => { if (gone) void h.remove(); else handle = h; }).catch(() => undefined);
    return () => { gone = true; void handle?.remove(); };
  }, [router]);

  // ---- Browser: the settings "test" button ----
  useEffect(() => {
    const onTest = (e: Event) => setTest((e as CustomEvent<AlarmItem>).detail);
    window.addEventListener(TEST_EVENT, onTest);
    return () => window.removeEventListener(TEST_EVENT, onTest);
  }, []);

  // ---- Browser: ring inside the open app ----
  const ringing = useMemo(
    () => (native ? null : test ?? dueNow(items, now, readAcked())[0] ?? null),
    // ackV forces a re-read of the acknowledged log after the stop button
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [native, test, items, now, ackV],
  );

  function stop() {
    if (ringing) ackAlarm(ringing.key, ringing.at);
    setTest(null);
    setAckV((v) => v + 1);
  }

  return ringing ? <RingOverlay item={ringing} onStop={stop} /> : null;
}

function RingOverlay({ item, onStop }: { item: AlarmItem; onStop: () => void }) {
  const { lang } = useApp();

  useEffect(() => {
    let ctx: AudioContext | null = null;
    let timer = 0;
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) {
        const c = new AC();
        ctx = c;
        const beep = (delay: number, freq: number) => {
          const o = c.createOscillator();
          const g = c.createGain();
          o.type = 'square';
          o.frequency.value = freq;
          g.gain.value = 0.18;
          o.connect(g);
          g.connect(c.destination);
          const t = c.currentTime + delay;
          o.start(t);
          o.stop(t + 0.22);
        };
        const ring = () => {
          void c.resume().catch(() => undefined);
          beep(0, 880); beep(0.32, 660); beep(0.64, 880); beep(0.96, 660);
          try { navigator.vibrate?.([300, 150, 300]); } catch { /* not supported */ }
        };
        ring();
        timer = window.setInterval(ring, 2200);
      }
    } catch {
      /* audio blocked: the overlay is still shown */
    }
    return () => {
      window.clearInterval(timer);
      void ctx?.close().catch(() => undefined);
    };
  }, []);

  return (
    <div role="alertdialog" aria-modal="true" aria-label={px(lang, 'alarmRinging')}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 bg-black/85 p-6 text-center text-white">
      <BellRing className="size-16 animate-bounce text-amber-300" aria-hidden />
      <p className="text-sm font-semibold text-amber-200">{item.title}</p>
      <p className="max-w-sm break-words text-2xl font-bold">{item.body}</p>
      <button type="button" onClick={onStop} autoFocus className="btn btn-primary mt-4 w-full max-w-xs py-4 text-lg">
        {px(lang, 'alarmStop')}
      </button>
    </div>
  );
}
