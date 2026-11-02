'use client';

import { useEffect, useState } from 'react';
import { Fingerprint, Loader2 } from 'lucide-react';
import { useApp } from '../Providers';
import { lockAvailable, lockEnabled, lockSupported, promptUnlock, setLockEnabled } from '@/lib/biometric';
import { p2 as tx } from '@/lib/ptext2';

/** App lock switch: fingerprint or phone PIN / pattern at every open (Android app only). */
export function BiometricSettings() {
  const { lang, notify } = useApp();
  const T = (k: Parameters<typeof tx>[1]) => tx(lang, k);
  const [state, setState] = useState<'checking' | 'nosupport' | 'nolock' | 'ready'>('checking');
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!lockSupported()) { if (alive) setState('nosupport'); return; }
      const ok = await lockAvailable();
      if (!alive) return;
      setOn(lockEnabled());
      setState(ok ? 'ready' : 'nolock');
    })();
    return () => { alive = false; };
  }, []);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    // Turning it on or off both need a successful fingerprint / PIN first.
    const ok = await promptUnlock(T('lockTitle'), T('lockPrompt'));
    setBusy(false);
    if (!ok) return notify(T('lockFail'), 'error');
    const next = !on;
    setLockEnabled(next);
    setOn(next);
    notify(T(next ? 'lockEnabledMsg' : 'lockDisabledMsg'));
  }

  return (
    <section className="card space-y-3">
      <h2 className="flex items-center gap-2 text-base font-bold"><Fingerprint className="size-5 text-brand-700 dark:text-brand-400" aria-hidden />{T('lockTitle')}</h2>
      {state === 'checking' ? null : state === 'nosupport' ? (
        <p className="text-sm text-muted dark:text-night-muted">{T('bioUnavailable')}</p>
      ) : state === 'nolock' ? (
        <p className="text-sm text-amber-800 dark:text-amber-300">{T('lockNoScreenLock')}</p>
      ) : (
        <>
          <p className="text-sm text-muted dark:text-night-muted">{T('lockNote')}</p>
          {on && <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">{T('lockOn')}</p>}
          <button type="button" onClick={toggle} disabled={busy} className={`btn w-full ${on ? 'border border-line dark:border-night-line' : 'btn-primary'}`}>
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {T(on ? 'lockDisable' : 'lockEnable')}
          </button>
        </>
      )}
    </section>
  );
}
