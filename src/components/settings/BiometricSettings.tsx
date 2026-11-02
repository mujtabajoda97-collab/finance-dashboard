'use client';

import { useEffect, useState } from 'react';
import { Fingerprint, Loader2 } from 'lucide-react';
import { useApp } from '../Providers';
import { useData } from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { biometricAvailable, biometricEnabled, disableBiometric, enableBiometric } from '@/lib/biometric';
import { px as tx } from '@/lib/ptext';

/** Optional fingerprint / screen-lock sign-in (Android app only). */
export function BiometricSettings() {
  const { lang, notify } = useApp();
  const { email } = useData();
  const T = (k: Parameters<typeof tx>[1]) => tx(lang, k);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [on, setOn] = useState(false);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    biometricAvailable().then((a) => { if (alive) { setAvailable(a); setOn(biometricEnabled()); } });
    return () => { alive = false; };
  }, []);

  async function enable(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !pw) return;
    setBusy(true);
    try {
      // Confirm the password is right before storing it.
      const { error } = await supabase().auth.signInWithPassword({ email, password: pw });
      if (error) { notify(T('loginBad'), 'error'); return; }
      await enableBiometric(email, pw, T('bioTitle'));
      setOn(true);
      setPw('');
      notify(T('bioEnabled'));
    } catch {
      notify(T('bioFail'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    await disableBiometric();
    setOn(false);
    notify(T('bioDisabled'));
  }

  return (
    <section className="card space-y-3">
      <h2 className="flex items-center gap-2 text-base font-bold"><Fingerprint className="size-5 text-brand-700 dark:text-brand-400" aria-hidden />{T('bioTitle')}</h2>
      {available === null ? null : !available ? (
        <p className="text-sm text-muted dark:text-night-muted">{T('bioUnavailable')}</p>
      ) : on ? (
        <button type="button" onClick={disable} className="btn w-full border border-line dark:border-night-line">{T('bioDisable')}</button>
      ) : (
        <form onSubmit={enable} className="space-y-3">
          <p className="text-sm text-muted dark:text-night-muted">{T('bioNote')}</p>
          <input type="password" className="field" dir="ltr" autoComplete="current-password" placeholder={T('bioNeedPw')} value={pw} onChange={(e) => setPw(e.target.value)} />
          <button type="submit" disabled={busy || !pw} className="btn btn-primary w-full">
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {T('bioEnable')}
          </button>
        </form>
      )}
    </section>
  );
}
