'use client';

import { useCallback, useEffect, useState } from 'react';
import { BellRing, Loader2 } from 'lucide-react';
import { useApp } from '../Providers';
import { ensureAlarmChannel, ensureAlarmPermission, isAlarmId, isNativeApp, nativeNotifications, scheduleTestAlarm } from '@/lib/alarm';
import { px } from '@/lib/ptext';

/** Settings: state of the voice alarm on this device, permission request and a 10-second test. */
export function AlarmSettings() {
  const { lang, notify } = useApp();
  const P = (k: Parameters<typeof px>[1]) => px(lang, k);
  const [native, setNative] = useState(false);
  const [perm, setPerm] = useState<'granted' | 'denied' | 'unknown'>('unknown');
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const ln = nativeNotifications();
    setNative(!!ln);
    if (!ln) return;
    try {
      const st = (await ln.checkPermissions()).display;
      setPerm(st === 'granted' ? 'granted' : 'denied');
      setPending((await ln.getPending()).notifications.filter((n) => isAlarmId(n.id)).length);
    } catch {
      setPerm('unknown');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function allow() {
    const ln = nativeNotifications();
    if (!ln) return;
    setBusy(true);
    try {
      await ensureAlarmChannel(ln);
      await ensureAlarmPermission(ln, true);
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  async function test() {
    setBusy(true);
    try {
      const ln = nativeNotifications();
      if (ln && !(await ensureAlarmPermission(ln, true))) {
        notify(P('alarmPermNo'), 'error');
        return;
      }
      await scheduleTestAlarm(`⏰ ${P('alarmTitle')}`, P('alarmDue'));
      notify(P('alarmTestSet'));
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  return (
    <section className="card space-y-3">
      <h2 className="flex items-center gap-2 text-base font-bold">
        <BellRing className="size-5 text-brand-700 dark:text-brand-400" aria-hidden />{P('alarmTitle')}
      </h2>
      <p className="text-sm">{isNativeApp() || native ? P('alarmNativeNote') : P('alarmWebNote')}</p>
      {native && (
        <p className="num text-xs text-muted dark:text-night-muted">
          {perm === 'granted' ? P('alarmPermOk') : P('alarmPermNo')} · {pending} {P('alarmScheduled')}
        </p>
      )}
      {native && perm !== 'granted' && (
        <button type="button" onClick={allow} disabled={busy} className="btn btn-primary w-full">{P('alarmEnablePerm')}</button>
      )}
      <button type="button" onClick={test} disabled={busy} className="btn w-full border border-line dark:border-night-line">
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {P('alarmTest')}
      </button>
      {native && <p className="rounded-xl bg-amber-400/10 p-3 text-xs text-amber-800 dark:text-amber-200">{P('alarmSoundTip')}</p>}
    </section>
  );
}
