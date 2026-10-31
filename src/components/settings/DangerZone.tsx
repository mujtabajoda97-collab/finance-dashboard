'use client';

import { useState } from 'react';
import { AlertOctagon, Loader2 } from 'lucide-react';
import { useApp } from '../Providers';
import { useData } from '@/lib/data';
import { Sheet } from '../Sheet';
import { supabase } from '@/lib/supabase';
import { px, type AnyKey } from '@/lib/ptext';

type Mode = 'transactions' | 'full';

/** Two reset actions. Each needs a fresh email OTP, which the database function re-checks. */
export function DangerZone() {
  const { lang, notify } = useApp();
  const { email } = useData();
  const T = (k: AnyKey) => px(lang, k);
  const [mode, setMode] = useState<Mode | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function request(m: Mode) {
    setBusy(true);
    const { error } = await supabase().auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    setBusy(false);
    if (error) return notify(error.message, 'error');
    notify(T('dzSent'));
    setCode('');
    setMode(m);
  }

  async function confirm() {
    if (!mode || code.length < 6) return;
    setBusy(true);
    const sb = supabase();
    const v = await sb.auth.verifyOtp({ email, token: code, type: 'email' });
    if (v.error) {
      setBusy(false);
      setCode('');
      return notify(T('otpInvalid'), 'error');
    }
    const { error } = await sb.rpc('reset_my_data', { p_mode: mode });
    setBusy(false);
    if (error) {
      const missing = /could not find the function|PGRST202|schema cache/i.test(error.message);
      return notify(missing ? T('dzSqlMissing') : error.message, 'error');
    }
    notify(T('dzDone'));
    setMode(null);
    setTimeout(() => window.location.reload(), 600);
  }

  const items: { m: Mode; title: AnyKey; desc: AnyKey }[] = [
    { m: 'transactions', title: 'dzOps', desc: 'dzOpsDesc' },
    { m: 'full', title: 'dzFull', desc: 'dzFullDesc' },
  ];

  return (
    <section className="card space-y-4 !border-rose-400/40">
      <h2 className="flex items-center gap-2 text-base font-bold text-rose-700 dark:text-rose-300">
        <AlertOctagon className="size-5" aria-hidden /> {T('dzTitle')}
      </h2>
      <p className="text-xs text-muted dark:text-night-muted">{T('dzNote')}</p>
      {items.map(({ m, title, desc }) => (
        <div key={m} className="space-y-2 rounded-2xl border border-rose-400/30 p-3">
          <p className="text-sm font-semibold">{T(title)}</p>
          <p className="text-xs text-muted dark:text-night-muted">{T(desc)}</p>
          <button type="button" disabled={busy} onClick={() => request(m)}
            className="btn w-full border border-rose-400/50 py-2 text-rose-700 dark:text-rose-300">
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {T('dzRequest')}
          </button>
        </div>
      ))}

      {mode && (
        <Sheet title={T('dzConfirmTitle')} onClose={() => !busy && setMode(null)}>
          <div className="space-y-3">
            <p className="text-sm">{T(mode === 'full' ? 'dzFull' : 'dzOps')}</p>
            <p className="text-sm text-muted dark:text-night-muted">{T('dzEnterCode')} <span dir="ltr" className="font-semibold">{email}</span></p>
            <input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={8} dir="ltr"
              className="field num text-center font-mono text-2xl tracking-[0.5em]"
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))} />
            <button type="button" disabled={busy || code.length < 6} onClick={confirm}
              className="btn w-full bg-rose-600 py-3 text-white disabled:opacity-50">
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {T('dzConfirmBtn')}
            </button>
          </div>
        </Sheet>
      )}
    </section>
  );
}
